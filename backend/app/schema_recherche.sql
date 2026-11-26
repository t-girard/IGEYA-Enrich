-- Accélère la recherche par fragment de nom et le rapprochement tolérant aux fautes de frappe.
-- Facultatif : si l'extension pg_trgm n'est pas autorisée, l'application fonctionne sans
-- (recherche plus lente, rapprochement limité aux noms identiques).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS fiches_recherche_trgm ON igeya.fiches USING gin (recherche gin_trgm_ops);
CREATE INDEX IF NOT EXISTS fiches_nom_trgm ON igeya.fiches USING gin (nom_norm gin_trgm_ops);
