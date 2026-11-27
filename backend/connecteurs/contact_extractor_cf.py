"""Connecteur Contact Extractor (Cloudflare) : scraping via Selenium.

Cherche les coordonnées d'un professionnel sur un site protégé par Cloudflare
en utilisant Chrome piloté par Selenium. Les données viennent de la base IGEYA
et les résultats y retournent directement ; il n'y a plus de CSV.

Variables requises :
- CF_SITE_URL   : URL de la page de recherche (ex. https://leakfun.com/dashboard/searches/breach)
- LOGIN_URL     : URL de la page de connexion (optionnel)
- LOGIN_USER    : identifiant (optionnel)
- LOGIN_PASS    : mot de passe (optionnel)

Dépendances Python à installer sur le serveur :
  pip install selenium undetected-chromedriver
"""

import os
import time

NOM = "Contact Extractor (CF)"
TYPE = "Scraping web"
DESCRIPTION = "Cherche des coordonnées sur un site protégé par Cloudflare via Chrome/Selenium."
CHAMPS = ["tel", "email"]
VARIABLES = ["CF_SITE_URL", "LOGIN_URL", "LOGIN_USER", "LOGIN_PASS"]
APPELS_PAR_SECONDE = 0.3  # ~1 fiche toutes les 3 s (délais Selenium inclus)
ACTIF = True

# ------------------------------------------------------------------ constantes UI
PAUSE = 1
CF_TIMEOUT = 30
SEL_SEARCH = "input[type='text'][data-form-type='other']"
TYPE_TOGGLE_LABEL = "Pseudo"
TYPE_OPTION_LABEL = "Code postal"
SEL_USER = "#email"
SEL_PASS = "#password"
SEL_SUBMIT = "button[type='submit'], input[type='submit']"

# ------------------------------------------------------------------ état partagé
# Le driver Chrome est réutilisé d'une fiche à l'autre pour éviter de relancer
# le navigateur à chaque appel. Il est créé au premier appel.
_driver = None
_connecte = False


# ================================================================== Selenium helpers
# (repris de test_cf_v3.3.py sans modification fonctionnelle)

def _forcer_page_active(driver):
    for cmd, args in (
        ("Emulation.setFocusEmulationEnabled", {"enabled": True}),
        ("Page.setWebLifecycleState", {"state": "active"}),
    ):
        try:
            driver.execute_cdp_cmd(cmd, args)
        except Exception:
            pass


_JS_CLIC_COMPLET = """
const el = arguments[0];
el.scrollIntoView({block: 'center'});
const r = el.getBoundingClientRect();
const base = {bubbles: true, cancelable: true, composed: true, view: window,
              clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
              button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true};
el.focus && el.focus();
el.dispatchEvent(new PointerEvent('pointerdown', {...base, buttons: 1}));
el.dispatchEvent(new MouseEvent('mousedown', {...base, buttons: 1}));
el.dispatchEvent(new PointerEvent('pointerup', base));
el.dispatchEvent(new MouseEvent('mouseup', base));
el.dispatchEvent(new MouseEvent('click', base));
"""

_JS_TROUVER_OPTION = """
const label = arguments[0];
const opts = document.querySelectorAll("[role='option']");
for (const o of opts) {
  if ((o.textContent || '').replace(/\\s+/g, ' ').includes(label)) return o;
}
return null;
"""

_JS_SELECT_NATIF = """
const label = arguments[0];
for (const s of document.querySelectorAll('select')) {
  for (const o of s.options) {
    if ((o.textContent || '').trim().includes(label)) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(s, o.value);
      s.dispatchEvent(new Event('input', {bubbles: true}));
      s.dispatchEvent(new Event('change', {bubbles: true}));
      return true;
    }
  }
}
return false;
"""


def _attendre_option(driver, label, delai=5.0):
    fin = time.time() + delai
    while time.time() < fin:
        option = driver.execute_script(_JS_TROUVER_OPTION, label)
        if option is not None:
            return option
        time.sleep(0.2)
    return None


def _choisir_type_recherche(driver):
    _forcer_page_active(driver)
    try:
        bouton = driver.find_element(
            "xpath",
            f"//button[@aria-haspopup='listbox'][.//span[normalize-space(.)={TYPE_TOGGLE_LABEL!r}]]",
        )
    except Exception:
        return False
    driver.execute_script(_JS_CLIC_COMPLET, bouton)
    option = _attendre_option(driver, TYPE_OPTION_LABEL)
    if option is None:
        try:
            driver.execute_script("arguments[0].focus();", bouton)
            for type_evt in ("keyDown", "keyUp"):
                driver.execute_cdp_cmd("Input.dispatchKeyEvent", {
                    "type": type_evt, "key": "ArrowDown", "code": "ArrowDown",
                    "windowsVirtualKeyCode": 40, "nativeVirtualKeyCode": 40,
                })
            option = _attendre_option(driver, TYPE_OPTION_LABEL)
        except Exception:
            pass
    if option is not None:
        driver.execute_script(_JS_CLIC_COMPLET, option)
        time.sleep(PAUSE / 2)
        return True
    if driver.execute_script(_JS_SELECT_NATIF, TYPE_OPTION_LABEL):
        time.sleep(PAUSE / 2)
        return True
    return False


def _est_page_defi_cf(driver):
    titre = driver.title.lower()
    return "just a moment" in titre or "un instant" in titre or "attention required" in titre


def _attendre_fin_defi_cf(driver, timeout=CF_TIMEOUT):
    if not _est_page_defi_cf(driver):
        _forcer_page_active(driver)
        return True
    _forcer_page_active(driver)
    debut = time.time()
    while time.time() - debut < timeout:
        time.sleep(2)
        _forcer_page_active(driver)
        if not _est_page_defi_cf(driver):
            return True
    return False


def _demarrer_xvfb():
    import subprocess
    for num in range(99, 120):
        display = f":{num}"
        proc = subprocess.Popen(
            ["Xvfb", display, "-screen", "0", "1280x900x24", "-nolisten", "tcp"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(0.5)
        if proc.poll() is None:
            os.environ["DISPLAY"] = display
            return proc
    return None


def _options_chrome(opts):
    opts.add_argument("--disable-background-timer-throttling")
    opts.add_argument("--disable-backgrounding-occluded-windows")
    opts.add_argument("--disable-renderer-backgrounding")
    opts.add_argument("--disable-features=CalculateNativeWinOcclusion")
    opts.add_argument("--window-position=-2400,-2400")
    opts.add_argument("--window-size=1280,900")
    return opts


def _creer_driver():
    """Lance Chrome via undetected-chromedriver + Xvfb."""
    import re
    import subprocess
    import undetected_chromedriver as uc
    _demarrer_xvfb()
    sortie = subprocess.run(["google-chrome", "--version"], capture_output=True, text=True).stdout
    version = int(re.search(r"(\d+)\.", sortie).group(1))
    opts = uc.ChromeOptions()
    _options_chrome(opts)
    return uc.Chrome(version_main=version, options=opts)


def _se_connecter(driver):
    global _connecte
    url = os.environ.get("LOGIN_URL", "")
    if not url:
        return
    user = os.environ.get("LOGIN_USER", "")
    pwd = os.environ.get("LOGIN_PASS", "")
    if not user or not pwd:
        return
    driver.get(url)
    time.sleep(PAUSE * 2)
    _attendre_fin_defi_cf(driver)
    try:
        driver.find_element("css selector", SEL_USER).send_keys(user)
        driver.find_element("css selector", SEL_PASS).send_keys(pwd)
        driver.find_element("css selector", SEL_SUBMIT).click()
    except Exception:
        return
    time.sleep(PAUSE)
    _connecte = True


def _rechercher(driver, termes):
    from selenium.webdriver.common.keys import Keys
    try:
        champ = driver.find_element("css selector", SEL_SEARCH)
    except Exception:
        return
    for terme in termes:
        champ.clear()
        champ.send_keys(terme)
        champ.send_keys(Keys.RETURN)
        time.sleep(PAUSE / 2)
    _choisir_type_recherche(driver)
    champ.send_keys(Keys.RETURN)
    time.sleep(PAUSE)


def _extraire_champ(driver, label_span):
    """Extrait les valeurs d'un champ dans tous les <article> de la page."""
    valeurs = []
    try:
        articles = driver.find_elements("tag name", "article")
        for article in articles:
            try:
                span = article.find_element(
                    "xpath",
                    f".//span[normalize-space(.)={label_span!r}]/ancestor::div[contains(@class, 'grid')]"
                    f"//span[contains(@class, 'font-mono')]",
                )
                val = span.text.strip()
                if val and val not in valeurs:
                    valeurs.append(val)
            except Exception:
                continue
    except Exception:
        pass
    return valeurs


# ================================================================== interface connecteur

def rechercher(fiche: dict) -> list:
    """Point d'entrée appelé par l'exécuteur IGEYA pour chaque fiche.

    Reçoit un dict avec au minimum nom, prenom, cp (et éventuellement ville).
    Renvoie une liste de propositions {champ, valeur, source, confiance}.
    """
    global _driver, _connecte

    url_site = os.environ.get("CF_SITE_URL", "").strip()
    if not url_site:
        raise RuntimeError("Variable CF_SITE_URL manquante")

    # Initialisation du driver (une seule fois par exécution du connecteur)
    if _driver is None:
        try:
            _driver = _creer_driver()
        except Exception as e:
            raise RuntimeError(f"Impossible de lancer Chrome : {e}") from e

    # Connexion au site (une seule fois)
    if not _connecte:
        _se_connecter(_driver)

    # Termes de recherche : nom + prénom + CP
    termes = [t for t in [fiche.get("nom", ""), fiche.get("prenom", ""), fiche.get("cp", "")] if t]
    if not termes:
        return []

    source = f"Contact Extractor · {fiche.get('nom', '')} {fiche.get('prenom', '')}".strip()

    try:
        _driver.get(url_site)
        time.sleep(PAUSE / 2)
        if not _attendre_fin_defi_cf(_driver):
            raise RuntimeError("Cloudflare : défi non résolu")

        _rechercher(_driver, termes)

        resultats = []
        for email in _extraire_champ(_driver, "Email"):
            resultats.append({"champ": "email", "valeur": email, "source": source, "confiance": 60})
        for tel in _extraire_champ(_driver, "Téléphone"):
            resultats.append({"champ": "tel", "valeur": tel, "source": source, "confiance": 60})

        return resultats

    except Exception as e:
        # En cas d'erreur Selenium (session perdue…), on réinitialise le driver
        try:
            _driver.quit()
        except Exception:
            pass
        _driver = None
        _connecte = False
        raise RuntimeError(f"Erreur Selenium : {e}") from e
