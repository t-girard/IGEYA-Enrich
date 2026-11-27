"""Parcours complet sur une vraie base : connexion, base, enrichissement, contrôle, import, diffusion, synchro."""
import pytest

from tests.conftest import ajouter_fiche

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------- connexion

def test_connexion(client):
    assert client.get("/api/stats").status_code == 401
    assert client.post("/api/login", json={"email": "test@igeya.fr", "password": "faux"}).status_code == 401
    assert client.post("/api/login", json={"email": "inconnu@igeya.fr", "password": "Mot-de-passe-test"}).status_code == 401
    r = client.post("/api/login", json={"email": " TEST@igeya.fr ", "password": "Mot-de-passe-test"})
    assert r.status_code == 200 and r.json() == {"email": "test@igeya.fr"}
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert client.get("/api/me").json() == {"email": "test@igeya.fr"}
    client.post("/api/logout")
    client.cookies.clear()
    assert client.get("/api/me").status_code == 401


def test_jeton_falsifie(client):
    client.cookies.set("igeya_session", "eyJlIjoidGVzdEBpZ2V5YS5mciIsIngiOjk5OTk5OTk5OTl9.0000")
    assert client.get("/api/me").status_code == 401


def test_route_inconnue(connecte):
    assert connecte.get("/api/nexiste-pas").status_code == 404


# ---------------------------------------------------------------- base de référence

def test_base_filtres_et_pagination(connecte):
    a = ajouter_fiche("Dupont", "Hélène", "38000", tel="+33 4 76 00 00 01")
    ajouter_fiche("Durand", "Paul", "69003", email="p@d.fr", metier="Infirmier", ville="Lyon")
    d1 = ajouter_fiche("Martin", "Léa", "38100")
    d2 = ajouter_fiche("Martin", "Lea", "38100")
    s = connecte.get("/api/stats").json()
    assert (s["fiches"], s["sans_tel"], s["sans_email"], s["doublons"]) == (4, 3, 3, 2)

    def noms(**params):
        return [f["nom"] + " " + f["prenom"] for f in connecte.get("/api/fiches", params=params).json()["rows"]]

    assert noms(q="helene") == ["Dupont Hélène"]          # sans accent
    assert noms(q="lyon") == ["Durand Paul"]             # par ville
    assert noms(metier="Infirmier") == ["Durand Paul"]
    assert noms(cp="38") == ["Dupont Hélène", "Martin Léa", "Martin Lea"]
    assert set(noms(missing="tel")) == {"Durand Paul", "Martin Léa", "Martin Lea"}
    assert set(noms(missing="dup")) == {"Martin Léa", "Martin Lea"}
    assert noms(q="100%") == []                          # % n'est pas un joker
    p = connecte.get("/api/fiches", params={"taille": 3, "page": 2}).json()
    assert (p["total"], p["pages"], p["page"], len(p["rows"])) == (4, 2, 2, 1)
    assert connecte.get("/api/metiers").json() == ["Infirmier", "Médecin"]
    assert connecte.get("/api/fiches/ids", params={"cp": "381"}).json() == [d1, d2]
    det = connecte.get(f"/api/fiches/{d1}").json()
    assert det["dups"] == [d2] and det["history"] == [] and det["pending"] == 0
    assert connecte.get(f"/api/fiches/{a}").json()["telSrc"]["source"] == "Reprise"
    assert connecte.get("/api/fiches/IGY-9999999").status_code == 404


# ---------------------------------------------------------------- connecteurs et tâches

def test_connecteurs_listes(connecte):
    cs = {c["id"]: c for c in connecte.get("/api/connecteurs").json()}
    assert set(cs) == {"faux", "faux2", "plante", "pause_auto"} and all(c["pret"] for c in cs.values())


def test_enrichissement_en_tache_de_fond(connecte):
    from app import executeur

    f1 = ajouter_fiche("Bernard", "Luc", "38000")
    f2 = ajouter_fiche("Sansresultat", "Ana", "38000")
    t = connecte.post("/api/taches", json={"connecteurs": ["faux", "faux2", "plante"], "cible": {"ids": [f1, f2]}}).json()
    assert (t["statut"], t["total"]) == ("queued", 2)
    assert executeur.traiter_une() is True
    assert executeur.traiter_une() is False
    t = connecte.get(f"/api/taches/{t['id']}").json()
    assert t["statut"] == "done" and t["fait"] == 2
    # faux et faux2 trouvent le même numéro sous deux formats : 1 création + 1 fusion, plus l'e-mail de faux2.
    assert (t["crees"], t["fusionnees"]) == (2, 1)
    assert t["erreurs"] == 2  # « plante » échoue sur les deux fiches sans arrêter la tâche
    assert any("source indisponible" in l for l in t["journal"])

    rows = connecte.get("/api/propositions").json()["rows"]
    tel = next(r for r in rows if r["p"]["field"] == "tel")
    assert tel["p"]["proposed"] == "+33 4 76 99 00 " + f1[-2:]
    assert len(tel["p"]["sources"]) == 2 and tel["p"]["conf"] == 88  # max(80, 75) + 8
    assert {x["k"] for x in tel["flags"]} == {"nouveau", "format", "multi"}
    mail = next(r for r in rows if r["p"]["field"] == "email")
    assert mail["p"]["proposed"] == "contact.bernard@exemple.fr"
    assert {x["k"] for x in mail["flags"]} == {"incertain", "nouveau", "format"}


def test_tache_par_filtre_et_annulation(connecte):
    from app import executeur

    for i in range(3):
        ajouter_fiche(f"Nom{i}", "X", "38000")
    ajouter_fiche("Complet", "Y", "38000", tel="+33 4 76 00 00 09")
    t = connecte.post("/api/taches", json={"connecteurs": ["faux"], "cible": {"filtre": {"missing": "tel"}}}).json()
    assert t["total"] == 3
    a = connecte.post("/api/taches", json={"connecteurs": ["faux"], "cible": {"ids": ["IGY-0000001"]}}).json()
    assert connecte.post(f"/api/taches/{a['id']}/annuler").json()["statut"] == "cancelled"
    executeur.traiter_une()
    assert connecte.get(f"/api/taches/{t['id']}").json()["statut"] == "done"
    assert executeur.traiter_une() is False  # la tâche annulée n'est pas exécutée
    assert connecte.post(f"/api/taches/{a['id']}/annuler").status_code == 409
    assert connecte.post(f"/api/taches/{a['id']}/reprendre").status_code == 409  # abandon définitif


def test_tache_refusee_si_connecteur_inconnu(connecte):
    r = connecte.post("/api/taches", json={"connecteurs": ["nexiste"], "cible": {"ids": ["x"]}})
    assert r.status_code == 400


# ---------------------------------------------------------------- contrôle et validation

def _proposer(fid, champ, valeur, conf=90, origine="faux"):
    from app import transit
    from app.db import connexion

    with connexion() as conn:
        f = conn.execute("SELECT id, tel, email FROM igeya.fiches WHERE id = %s", (fid,)).fetchone()
        return transit.ajouter_proposition(conn, f, champ, valeur, source="Test", confiance=conf, origine=origine)


def test_controle_signalements_et_decisions(connecte):
    a = ajouter_fiche("Petit", "Jean", "38000", tel="+33 4 76 11 11 11")
    b = ajouter_fiche("Robert", "Anne", "38000")
    c = ajouter_fiche("Simon", "Eve", "38000", tel="+33 4 76 22 22 22")
    assert _proposer(b, "tel", "04 76 11 11 11") == "created"     # numéro déjà porté par la fiche a
    assert _proposer(b, "tel", "06 12 34 56 78") == "created"     # deux valeurs différentes pour b
    assert _proposer(c, "tel", "+33 4 76 22 22 22") == "same"     # déjà sur la fiche
    assert _proposer(c, "tel", "0476333333", conf=95) == "created"
    assert _proposer(c, "email", "pas-un-mail") == "created"
    assert _proposer(a, "email", "") == "vide"

    res = connecte.get("/api/propositions").json()
    assert res["counts"]["pending"] == 4 and res["total"] == 4
    flags = {(r["f"]["id"], r["p"]["proposed"]): {x["k"] for x in r["flags"]} for r in res["rows"]}
    assert flags[(b, "+33 4 76 11 11 11")] == {"doublon", "divergence", "nouveau", "format"}
    assert flags[(c, "+33 4 76 33 33 33")] == {"conflit", "format"}
    assert flags[(c, "pas-un-mail")] == {"invalide"}
    dbl = next(r for r in res["rows"] if r["p"]["proposed"] == "+33 4 76 11 11 11")
    assert next(x for x in dbl["flags"] if x["k"] == "doublon")["d"] == "Cette valeur est déjà sur la fiche Jean PETIT (38000)"
    assert res["fiables"] == 0  # remplacement, doublon, divergence ou invalide : rien d'automatique

    assert [r["p"]["proposed"] for r in connecte.get("/api/propositions", params={"flag": "divergence"}).json()["rows"]] == \
        ["+33 4 76 11 11 11", "+33 6 12 34 56 78"]
    assert len(connecte.get("/api/propositions", params={"q": "simon"}).json()["rows"]) == 2

    ids = {r["p"]["proposed"]: r["p"]["id"] for r in res["rows"]}
    r = connecte.post("/api/propositions/decision", json={"action": "accepter", "ids": [ids["+33 4 76 33 33 33"], ids["pas-un-mail"]]}).json()
    assert (r["ok"], r["ignorees"]) == (1, 1)  # une valeur invalide ne peut pas être acceptée
    fc = connecte.get(f"/api/fiches/{c}").json()
    assert fc["tel"] == "+33 4 76 33 33 33" and fc["push"]["one"] == "todo"
    assert fc["history"][0] == {**fc["history"][0], "from": "+33 4 76 22 22 22", "to": "+33 4 76 33 33 33", "by": "test@igeya.fr", "source": "Test"}

    assert connecte.post("/api/propositions/decision", json={"action": "rejeter", "ids": [ids["+33 6 12 34 56 78"]]}).json()["ok"] == 1
    assert connecte.get("/api/propositions", params={"statut": "rejected"}).json()["total"] == 1
    assert connecte.post("/api/propositions/decision", json={"action": "remettre", "ids": [ids["+33 6 12 34 56 78"]]}).json()["ok"] == 1


def test_accepter_fiables(connecte):
    a = ajouter_fiche("Lambert", "Zoe", "38000")
    b = ajouter_fiche("Girard", "Tom", "38000")
    _proposer(a, "tel", "04 76 44 44 44", conf=90)
    _proposer(b, "tel", "04 76 55 55 55", conf=50)  # confiance faible : pas fiable
    assert connecte.get("/api/propositions").json()["fiables"] == 1
    assert connecte.post("/api/propositions/accepter-fiables").json()["ok"] == 1
    assert connecte.get(f"/api/fiches/{a}").json()["tel"] == "+33 4 76 44 44 44"
    assert connecte.get(f"/api/fiches/{b}").json()["tel"] == ""


# ---------------------------------------------------------------- import de fichier

def test_import_rapprochement_et_envoi(connecte):
    a = ajouter_fiche("Fontaine", "Marie", "75011")
    ajouter_fiche("Chevalier", "Paul", "38000")
    ajouter_fiche("Chevalier", "Paula", "38000")
    lignes = [
        {"line": 2, "nom": "FONTAINE", "prenom": "Marie", "cp": "75011", "tel": "01.43.00.00.01"},
        {"line": 3, "nom": "Fontaine", "prenom": "Marie", "cp": "75011", "email": "marie@cabinet.fr"},  # répétée
        {"line": 4, "nom": "Fontaines", "prenom": "Marie", "cp": "75011"},                                # faute de frappe
        {"line": 5, "nom": "Chevalier", "prenom": "P", "cp": "38000"},                                    # deux fiches possibles
        {"line": 6, "nom": "Inconnu", "prenom": "Zed", "cp": "13000"},
        {"line": 7, "nom": "Fontaine", "prenom": "Marie", "cp": "5011"},                                  # zéro perdu par Excel
    ]
    res = {r["line"]: r for r in connecte.post("/api/import/rapprocher", json={"lignes": lignes}).json()["result"]}
    assert res[2]["status"] == "certain" and res[2]["best"]["ficheId"] == a and res[2]["email"] == "marie@cabinet.fr"
    assert res[3]["status"] == "doublon" and res[3]["dupOf"] == 2
    assert res[4]["status"] == "incertain" and res[4]["best"]["m"]["tN"] == "proche"
    assert res[5]["status"] == "incertain" and res[5]["ambiguous"] is True
    assert res[6]["status"] == "aucune"
    assert res[7]["cp"] == "05011"

    r = connecte.post("/api/import/envoyer", json={"fichier": "test.csv", "lignes": [
        {"line": 2, "ficheId": a, "tel": "01.43.00.00.01", "email": "marie@cabinet.fr", "score": 100},
        {"line": 4, "ficheId": a, "tel": "01 43 00 00 01", "score": 86},
    ]}).json()
    assert r == {"created": 2, "merged": 1, "same": 0}
    rows = connecte.get("/api/propositions", params={"origine": "fichier"}).json()["rows"]
    tel = next(x for x in rows if x["p"]["field"] == "tel")
    assert [s["label"] for s in tel["p"]["sources"]] == ["Fichier test.csv (ligne 2)", "Fichier test.csv (ligne 4)"]


# ---------------------------------------------------------------- diffusion

def test_diffusion_one_outreach(connecte):
    from app.db import connexion

    a = ajouter_fiche("Henry", "Lou", "38000", rpps="10000000042")
    _proposer(a, "tel", "04 76 77 77 77")
    pid = connecte.get("/api/propositions").json()["rows"][0]["p"]["id"]
    connecte.post("/api/propositions/decision", json={"action": "accepter", "ids": [pid]})
    etat = connecte.get("/api/diffusion").json()
    assert etat["one"]["n"] == 1 and etat["out"]["n"] == 0
    assert etat["one"]["exemple"]["telephone"] == "+33476777777"
    r = connecte.post("/api/diffusion/ONE").json()
    assert r["n"] == 1
    assert connecte.post("/api/diffusion/ONE").json()["n"] == 0
    with connexion() as conn:
        d = conn.execute("SELECT destination, donnees, lu_le FROM igeya.diffusion").fetchall()
        v = conn.execute("SELECT * FROM igeya.v_one_prospects WHERE id_externe = %s", (a,)).fetchone()
    assert len(d) == 1 and d[0]["donnees"]["rpps"] == "10000000042" and d[0]["lu_le"] is None
    assert v["telephone"] == "+33476777777"
    assert connecte.get(f"/api/fiches/{a}").json()["push"]["one"] == "ok"
    assert connecte.get("/api/diffusion").json()["journal"][0]["dest"] == "ONE"


# ---------------------------------------------------------------- synchronisation Annuaire Santé

def _bundle(rpps, tel, specialite, actif=True, org_id="o1", role_id="r1", cp="38000"):
    TRE = "https://mos.esante.gouv.fr/NOS/TRE_{}/FHIR/TRE-{}"
    return {"resourceType": "Bundle", "entry": [
        {"resource": {"resourceType": "PractitionerRole", "id": role_id, "active": actif,
                      "practitioner": {"reference": "Practitioner/p1"}, "organization": {"reference": f"Organization/{org_id}"},
                      "telecom": [{"system": "phone", "value": tel}],
                      "code": [{"coding": [{"system": TRE.format("R38-SpecialiteOrdinale", "R38"), "code": "SM54", "display": specialite}]}],
                      "meta": {"lastUpdated": "2026-11-20T10:00:00Z"}}},
        {"resource": {"resourceType": "Practitioner", "id": "p1",
                      "identifier": [{"type": {"coding": [{"code": "RPPS"}]}, "value": rpps}],
                      "name": [{"family": "DUPONT", "given": ["Marie"]}],
                      "qualification": [{"code": {"coding": [{"system": TRE.format("G15-ProfessionSante", "G15"), "code": "10"}]}}],
                      "telecom": [{"system": "email", "value": "marie.dupont@mssante.fr"}],
                      "meta": {"lastUpdated": "2026-11-20T10:00:00Z"}}},
        {"resource": {"resourceType": "Organization", "id": org_id, "name": "Cabinet du Parc",
                      "address": [{"line": ["1 rue du Parc"], "postalCode": cp, "city": "Grenoble"}],
                      "meta": {"lastUpdated": "2026-11-20T10:00:00Z"}}},
    ]}


def test_synchro_annuaire(connecte):
    from app import synchro

    bilan = synchro.synchroniser("test", bundles=[(1, _bundle("10000000001", "04.76.12.34.56", "Médecine générale"))])
    assert bilan == {"pages": 1, "lignes": 1, "creees": 1, "maj": 0}
    f = connecte.get("/api/fiches", params={"q": "dupont"}).json()["rows"][0]
    assert (f["nom"], f["prenom"], f["metier"], f["specialite"], f["cp"]) == ("DUPONT", "Marie", "Médecin", "Médecine générale", "38000")
    assert f["tel"] == "+33 4 76 12 34 56" and f["telSrc"]["source"] == synchro.SOURCE
    assert f["email"] == "marie.dupont@mssante.fr" and f["push"] == {"one": "todo", "out": "todo"}

    # Deuxième passage : nouveau lieu, autre numéro. Le téléphone existant n'est pas écrasé.
    bilan = synchro.synchroniser("test", bundles=[(1, _bundle("10000000001", "04 76 99 99 99", "Médecine générale",
                                                               org_id="o2", role_id="r2", cp="38100"))])
    assert bilan["maj"] == 1
    d = connecte.get(f"/api/fiches/{f['id']}").json()
    assert d["tel"] == "+33 4 76 12 34 56" and d["cp"] == "38000"
    assert sorted(l["cp"] for l in d["lieux"]) == ["38000", "38100"]
    h = connecte.get("/api/synchro").json()["historique"]
    assert [s["statut"] for s in h] == ["done", "done"] and h[0]["depuis"] is not None and h[1]["depuis"] is None

    # Tous les lieux inactifs : fiche inactive.
    synchro.synchroniser("test", bundles=[(1, _bundle("10000000001", "", "Médecine générale", actif=False))])
    synchro.synchroniser("test", bundles=[(1, _bundle("10000000001", "", "Médecine générale", actif=False, org_id="o2", role_id="r2"))])
    assert connecte.get(f"/api/fiches/{f['id']}").json()["actif"] is False


def test_synchro_echec_enregistre(connecte):
    from app import synchro

    def casse():
        yield 1, {"entry": [{"resource": {"resourceType": "PractitionerRole", "id": "x"}}]}
        raise RuntimeError("Erreur HTTP 401 sur …")

    with pytest.raises(RuntimeError):
        synchro.synchroniser("test", bundles=casse())
    s = connecte.get("/api/synchro").json()["historique"][0]
    assert s["statut"] == "failed" and "401" in s["message"]


def test_executeur_en_arriere_plan(connecte):
    """Le vrai fil d'exécution (verrou Postgres, réveil) traite une tâche sans intervention."""
    import time

    from app import executeur

    f = ajouter_fiche("Arriere", "Plan", "38000")
    executeur.demarrer()
    try:
        t = connecte.post("/api/taches", json={"connecteurs": ["faux"], "cible": {"ids": [f]}}).json()
        for _ in range(100):
            if connecte.get(f"/api/taches/{t['id']}").json()["statut"] == "done":
                break
            time.sleep(0.1)
        assert connecte.get(f"/api/taches/{t['id']}").json()["statut"] == "done"
    finally:
        executeur.arreter()
    assert connecte.get("/api/stats").json()["pending"] == 1


def test_pause_et_reprise(connecte):
    from app import executeur
    from app.db import connexion

    ids = [ajouter_fiche(f"Pause{i}", "X", "38000") for i in range(3)]
    t = connecte.post("/api/taches", json={"connecteurs": ["pause_auto"], "cible": {"ids": ids}}).json()
    executeur.traiter_une()
    t = connecte.get(f"/api/taches/{t['id']}").json()
    assert (t["statut"], t["fait"]) == ("paused", 1)          # arrêt propre après la fiche en cours
    assert t["fin"] is None and "Mise en pause" in t["journal"][0]
    assert executeur.traiter_une() is False                   # une tâche en pause n'est pas reprise seule
    assert connecte.post(f"/api/taches/{t['id']}/pause").status_code == 409
    r = connecte.post(f"/api/taches/{t['id']}/reprendre").json()
    assert (r["statut"], r["reprises"]) == ("queued", 1)
    executeur.traiter_une()
    t = connecte.get(f"/api/taches/{t['id']}").json()
    assert (t["statut"], t["fait"], t["crees"]) == ("done", 3, 3)  # ni fiche refaite, ni fiche oubliée
    assert connecte.get("/api/propositions").json()["total"] == 3

    # Pause d'une tâche encore en attente, puis abandon.
    t2 = connecte.post("/api/taches", json={"connecteurs": ["faux"], "cible": {"ids": ids[:1]}}).json()
    assert connecte.post(f"/api/taches/{t2['id']}/pause").json()["statut"] == "paused"
    assert executeur.traiter_une() is False
    assert connecte.post(f"/api/taches/{t2['id']}/annuler").json()["statut"] == "cancelled"

    # Redémarrage du serveur pendant une mise en pause : la tâche finit « en pause ».
    with connexion() as conn:
        conn.execute("UPDATE igeya.taches SET statut = 'pausing' WHERE id = %s", (t["id"],))
    executeur.reprendre_interrompues()
    assert connecte.get(f"/api/taches/{t['id']}").json()["statut"] == "paused"


def test_reprise_apres_echec(connecte):
    from app import executeur
    from app.db import connexion

    f = ajouter_fiche("Echec", "Z", "38000")
    t = connecte.post("/api/taches", json={"connecteurs": ["faux"], "cible": {"ids": [f]}}).json()
    with connexion() as conn:
        conn.execute("UPDATE igeya.taches SET statut = 'failed', message = 'coupure' WHERE id = %s", (t["id"],))
    r = connecte.post(f"/api/taches/{t['id']}/reprendre").json()
    assert (r["statut"], r["message"]) == ("queued", "")
    executeur.traiter_une()
    assert connecte.get(f"/api/taches/{t['id']}").json()["statut"] == "done"
