import os
import re
import base64
import pyodbc
import unicodedata
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from langchain.vectorstores import Chroma
from langchain.embeddings import HuggingFaceEmbeddings

# ------------------------------------------------------------
# Flask + embeddings + vectordb
# ------------------------------------------------------------
app = Flask(__name__)

embedding_model = HuggingFaceEmbeddings(
    model_name="intfloat/multilingual-e5-small",
    cache_folder="embeddings_model"
)
vectordb = Chroma(
    persist_directory="persist_directory_match",
    embedding_function=embedding_model
)

# ------------------------------------------------------------
# Connexion SQL Server
# ------------------------------------------------------------
load_dotenv()
connection_string = (
    f"DRIVER={{ODBC Driver 17 for SQL Server}};"
    f"SERVER={os.getenv('DB_SERVER')},{os.getenv('DB_PORT')};"
    f"DATABASE={os.getenv('DB_DATABASE')};"
    f"UID={os.getenv('DB_USER')};"
    f"PWD={os.getenv('DB_PASSWORD')};"
    f"Encrypt=no;TrustServerCertificate=yes;"
)
sql_conn = pyodbc.connect(connection_string)
sql_cur = sql_conn.cursor()

# ------------------------------------------------------------
# Helpers (normalisation & utils)
# ------------------------------------------------------------
def _blob_to_data_uri(blob_bytes, mime="image/jpeg"):
    if not blob_bytes:
        return None
    try:
        return f"data:{mime};base64," + base64.b64encode(blob_bytes).decode("utf-8")
    except Exception:
        return None

def _normalize(s: str) -> str:
    s = s or ""
    s = s.lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return " ".join("".join(ch if (ch.isalnum() or ch.isspace()) else " " for ch in s).split())

def _canonize(s: str) -> str:
    s = s or ""
    return " ".join(s.strip().lower().split())

def _candidate_variants(cand: str):
    """variantes plausibles d'une taille : '4 ans' -> {'4 ans','04 ans'}"""
    cand = _canonize(cand)
    vars_ = {cand}
    m = re.match(r"^(\d{1,2})\s*ans$", cand)
    if m:
        n = int(m.group(1))
        vars_.add(f"{n} ans")
        vars_.add(f"{n:02d} ans")
    return vars_

def _norm_color_phrase(s: str) -> str:
    # normalise + remplace / et - par espace + compacte espaces
    s = _normalize(s)
    s = s.replace("/", " ").replace("-", " ")
    return " ".join(s.split())

# --- Tailles alpha (XS, S, M, L, XL, XXL, 2XL, ...) ---
TAILLE_ALPHA_RE = re.compile(r'^(xs|s|m|l|xl|xxl|xxxl|xxxxl|[2-5]xl)$')

def _is_alpha_size_token(tok: str) -> bool:
    return bool(TAILLE_ALPHA_RE.match(_canonize(tok)))

def _canonize_alpha_size(tok: str) -> str:
    """'2xl' -> 'xxl', '3xl' -> 'xxxl', tout en minuscule sans espaces."""
    t = _canonize(tok)
    m = re.match(r'^(\d)xl$', t)
    if m:
        t = 'x' * int(m.group(1)) + 'l'
    return t

def _alpha_like_pattern(tok: str) -> str:
    """
    Transforme 'xxl' en pattern LIKE '%x%x%l%'.
    Marche sur 'xxl', 'x xl', 'x-xl', 'XXL (EU)', etc.
    """
    t = _canonize_alpha_size(tok)
    compact = re.sub(r'[^a-z0-9]', '', t)
    return '%' + '%'.join(list(compact)) + '%'

# --- Tailles volume/parfum (50ml, 100 ml, 200ML, 50cl, 1l) ---
VOLUME_SIZE_FULL_RE = re.compile(r"^(\d{1,4})\s*(ml|cl|l)$", re.I)
VOLUME_SIZE_INLINE_RE = re.compile(r"(\d{1,4})\s*(ml|cl|l)", re.I)

def _is_volume_size_token(tok: str) -> bool:
    return bool(VOLUME_SIZE_FULL_RE.match(_canonize(tok)))

def _canonize_volume_size(s: str) -> str:
    m = VOLUME_SIZE_INLINE_RE.search(_canonize(s))
    if not m:
        return ""
    n, u = m.group(1), m.group(2).lower()
    return f"{int(n)} {u}"  # ex: "050ML" -> "50 ml"

def _volume_like_param(s: str):
    c = _canonize_volume_size(s)
    return f"%{c.replace(' ', '')}%" if c else None  # on matche "50ml" sans espaces


def _color_like_param(c: str) -> str:
    # normalise la phrase et supprime espaces / tirets / slash
    core = re.sub(r"[\s/-]+", "", _normalize(c))
    return f"%{core}%"


def _stem_fr(w: str) -> str:
    w = (w or "").lower()
    # pluriel en "es" -> enlève "es" (chemises -> chemis)
    if len(w) > 4 and w.endswith("es"):
        return w[:-2]
    # singulier en "e" précédé de 's' -> enlève le 'e' (chemise -> chemis)
    if len(w) > 4 and w.endswith("e") and w[-2] == "s":
        return w[:-1]
    # pluriel générique en "s"
    if len(w) > 3 and w.endswith("s"):
        return w[:-1]
    return w


def _normalize_color_morph_text(s: str) -> str:
    """
    Ramène les formes féminines / plurielles vers la forme canonique.
    Entrée libre (phrase), sortie normalisée comme _norm_color_phrase.
    """
    t = _norm_color_phrase(s)  # déjà _normalize + remplace / - par espace
    # Règles sans accents (car _normalize enlève les accents)
    rules = [
        (r"\bblanches?\b", "blanc"),
        (r"\bnoires?\b", "noir"),
        (r"\bbleues?\b", "bleu"),
        (r"\bvertes?\b", "vert"),
        (r"\bgrises?\b", "gris"),
        (r"\bviolettes?\b", "violet"),
        (r"\bdorees?\b", "dore"),
        (r"\bfoncees?\b", "fonce"),
        (r"\bclaires?\b", "clair"),
        (r"\bbeiges?\b", "beige"),
        (r"\boranges?\b", "orange"),
        (r"\bjaunes?\b", "jaune"),
        (r"\broses?\b", "rose"),
        (r"\bmarines?\b", "marine"),
        (r"\bsaumons?\b", "saumon"),
    ]
    for pat, rep in rules:
        t = re.sub(pat, rep, t)
    return t


def _is_color_token(tok: str) -> bool:
    """
    True si 'tok' est un token couleur (directement ou après morpho).
    """
    n = _normalize(tok)
    if n in COLOR_TOKENS:
        return True
    n2 = _normalize_color_morph_text(n)  # ex: 'blanches' -> 'blanc'
    return any(tt in COLOR_TOKENS for tt in n2.split())



# ------------------------------------------------------------
# Stopwords / Synonymes / Irréguliers
# ------------------------------------------------------------
STOPWORDS_FR = {
    "je","veux","veut","une","un","le","la","les","des","de","du","au","aux",
    "et","ou","pour","sur","dans","avec","sans","a","à","mon","ma","mes","ton","ta","tes",
    "est","cest","ce","cela","ça","quel","quelle","quels","quelles","me","moi","toi","vous","nous",
    # verbes d'intention
    "acheter","achete","achetes","achetez","acheterai","achetera","achat","achats",
    "chercher","cherche","cherches","recherche","recherches","recherchez",
    "trouver","trouve","trouves","trouvez","besoin","envie",
    # mots de critères à ignorer pour le titre
    "taille","tailles","couleur","couleurs","ans","an","age","âge","pointure","pointures",
    # unités volumétriques
    "ml","cl","l"
}

SYNONYMS = {
    "botte": {"botte","bottes","bottine","bottines","bottillon","bottillons"},
    "polo": {"polo","polos"},
    "chemise": {"chemise","chemises"},
}

IRREGULARS = {
    "chevaux": "cheval",
    "yeux": "oeil",
    "travaux": "travail",
}

# --- Synonym groups for LIKE building ---
SYN_CANON = {}
SYN_GROUPS = {}
for root, forms in SYNONYMS.items():
    grp = set(forms) | {root}
    root_n = _normalize(root)
    for f in grp:
        SYN_CANON[_normalize(f)] = root_n
    SYN_GROUPS[root_n] = { _normalize(x) for x in grp }

# ------------------------------------------------------------
# Couleurs depuis la base (utilise helpers ci-dessus)
# ------------------------------------------------------------
def load_all_couleurs():
    rows = sql_cur.execute(
        """
        SELECT DISTINCT GDI_LIBELLE
        FROM DIMENSION
        WHERE GDI_TYPEDIM = 'DI2'
        """
    ).fetchall()
    phrases = {}   # normalized phrase -> original phrase (lower)
    tokens  = set()
    for r in rows:
        if not getattr(r, "GDI_LIBELLE", None):
            continue
        orig = str(r.GDI_LIBELLE).strip().lower()
        norm = _norm_color_phrase(orig)
        if not norm:
            continue
        phrases[norm] = orig
        # on stocke les tokens (mots) pour filtrer dans _keywords
        for t in norm.split():
            if len(t) >= 2:
                tokens.add(t)
    return phrases, tokens

COLOR_PHRASES, COLOR_TOKENS = load_all_couleurs()

# ------------------------------------------------------------
# Tailles : chargement depuis la base
# ------------------------------------------------------------
def load_all_tailles():
    tailles_set = set()
    rows = sql_cur.execute(
        """
        SELECT DISTINCT GDI_LIBELLE
        FROM DIMENSION
        WHERE GDI_TYPEDIM = 'DI1'
        """
    ).fetchall()
    for r in rows:
        if r.GDI_LIBELLE:
            tailles_set.add(_normalize(r.GDI_LIBELLE))
    return tailles_set

ALL_TAILLES = load_all_tailles()

# ------------------------------------------------------------
# Extraction des mots-clés (titre) sans couleurs ni tailles alpha/volume
# ------------------------------------------------------------
def _keywords(user_text: str):
    tokens = _normalize(user_text).split()
    toks = []
    for t in tokens:
        if len(t) < 2:
            continue
        if t in STOPWORDS_FR:
            continue
        if t.isdigit():
            continue
        if t in {"ml", "cl", "l"}:  # ignorer unités isolées
            continue
        if _is_color_token(t):          # ignore couleurs (depuis la base)
            continue
        if _is_alpha_size_token(t):     # ignore tailles alpha
            continue
        if _is_volume_size_token(t):    # ignore volumes "50ml"...
            continue
        toks.append(t)

    expanded = set()
    for t in toks:
        expanded.add(t)
        if t in IRREGULARS:
            expanded.add(IRREGULARS[t])
        if t.endswith("s") and len(t) > 3:
            expanded.add(t[:-1])  # pluriel -> singulier simple

    final = set()
    for form in expanded:
        final.add(form)
        final |= SYNONYMS.get(form, set())
        for root, forms in SYNONYMS.items():
            if form in forms:
                final |= forms | {root}
    return sorted(final, key=len, reverse=True)

# ------------------------------------------------------------
# Parsing critères (taille/couleur/budget)
# ------------------------------------------------------------
def parse_criteria(user_text: str):
    txt = _normalize(user_text)
    taille = None
    couleur = None
    budget = None

    # 0) Taille volume (parfum) : "50ml", "100 ml", etc., avec ou sans mot-cle "taille"
    m = re.search(r"(?:\btaille\b|\bt)\s*(\d{1,4})\s*(ml|cl|l)\b", txt)
    if m:
        taille = f"{int(m.group(1))} {m.group(2).lower()}"
    else:
        m = VOLUME_SIZE_INLINE_RE.search(txt)
        if m:
            taille = f"{int(m.group(1))} {m.group(2).lower()}"

    # 1) Taille juste après "taille" ou "t" (si pas déjà trouvé)
    if not taille:
        m = re.search(r"(?:\btaille\b|\bt)\s*([a-z0-9]+)(?:\s*(ans))?\b", txt)
        if m:
            first = m.group(1)
            has_ans = m.group(2) is not None
            raw = f"{first} ans" if has_ans else first

            # a) si alpha (xl, 2xl, …)
            if _is_alpha_size_token(raw):
                taille = _canonize_alpha_size(raw)
            else:
                # b) sinon, logique existante (âges, etc.)
                raw = re.sub(r"^t(?=\d)", "", raw)  # "t38" -> "38"
                for v in _candidate_variants(raw):
                    if v in ALL_TAILLES:
                        taille = v
                        break
                if not taille and _normalize(raw) in ALL_TAILLES:
                    taille = _normalize(raw)

    # 2) Si toujours rien : capter "… 4 ans …"
    if not taille:
        m = re.search(r"\b(\d{1,2})\s*ans\b", txt)
        if m:
            raw_age = f"{int(m.group(1))} ans"
            for v in _candidate_variants(raw_age):
                if v in ALL_TAILLES:
                    taille = v
                    break

    # 2.5) Si toujours rien : capter une taille alpha n'importe où
    if not taille:
        m = re.search(r"\b(xs|s|m|l|xl|xxl|xxxl|xxxxl|[2-5]xl)\b", txt)
        if m:
            taille = _canonize_alpha_size(m.group(1))

    # 3) Fallback final : scan des tailles connues (comme avant)
    if not taille:
        for t in sorted([x for x in ALL_TAILLES if len(x) >= 2], key=len, reverse=True):
            if t in txt:
                taille = t
                break

    # 4) Couleur : on choisit la plus longue expression couleur trouvée
    txt_morph = _normalize_color_morph_text(user_text)  # ex: "blanches" -> "blanc"
    best = None
    best_len = 0
    for norm_phrase, orig_phrase in COLOR_PHRASES.items():
        if norm_phrase and norm_phrase in txt_morph:
            L = len(norm_phrase)
            if L > best_len:
                best = orig_phrase
                best_len = L
    if best:
        couleur = best  # ex: "blanc/bleu ciel" ou "gris foncé" ou "stonewash"


    # 5) Budget
    m = re.search(r"(\d+)\s*(€|euro|euros)", txt)
    if m:
        try:
            budget = float(m.group(1))
        except Exception:
            pass

    return taille, couleur, budget

# ------------------------------------------------------------
# LIKE clause pour le titre (GA_LIBELLE)
# ------------------------------------------------------------
def _build_like_clause(column: str, keywords: list[str], original_text: str = ""):
    if not keywords:
        return "(1=1)", []

    norm_tokens = _normalize(original_text).split()
    kwset = set(keywords)
    phrase_tokens = [t for t in norm_tokens if t in kwset]

    clauses, params = [], []

    # OR sur la phrase compacte utile (ex: "polo femme", "chemise oxford")
    if len(phrase_tokens) >= 2:
        compact = " ".join(phrase_tokens)
        clauses.append(f"{column} LIKE ?")
        params.append(f"%{compact}%")

    # Groupes par concept (synonymes) sinon par stem
    def concept_key(w: str):
        w = _normalize(w)
        return ("syn", SYN_CANON[w]) if w in SYN_CANON else ("stem", _stem_fr(w))

    groups = {}
    for w in keywords:
        key = concept_key(w)
        groups.setdefault(key, set()).add(_normalize(w))

    group_sqls = []
    for (kind, key), forms in groups.items():
        # si concept synonyme, élargir à toutes les formes du groupe
        if kind == "syn":
            forms = SYN_GROUPS.get(key, forms)
        or_sql = "(" + " OR ".join([f"{column} LIKE ?" for _ in forms]) + ")"
        group_sqls.append(or_sql)
        params.extend([f"%{k}%" for k in forms])

    if group_sqls:
        clauses.append("(" + " AND ".join(group_sqls) + ")")

    sql = "(" + " OR ".join(clauses) + ")"
    return sql, params

# ------------------------------------------------------------
# Fetch SQL avec filtres
# ------------------------------------------------------------
def fetch_article_with_variants_filtered(code_article: str, keywords: list[str], taille=None, couleur=None, budget=None):
    like_sql, like_params = _build_like_clause("A.GA_LIBELLE", keywords)

    header_params = [code_article] + like_params
    header_extra = ""

    if budget is not None:
        header_extra += " AND A.GA_PVTTC <= ?"
        header_params.append(budget)

    # EXISTS si taille/couleur fournis
    if taille or couleur:
        exists_clauses = []
        exists_params = []
        if taille:
            if "ans" in str(taille):
                # ex. "14 ans" -> "%14%ans%"
                taille_pat = _canonize(str(taille)).replace(" ", "%")
                exists_clauses.append("LOWER(D1x.GDI_LIBELLE) LIKE ?")
                exists_params.append(f"%{taille_pat}%")
            elif _is_alpha_size_token(str(taille)):
                # alpha (xl, xxl, 2xl …)
                pat = _alpha_like_pattern(str(taille))  # ex. %x%x%l%
                # on tolère espaces et tirets en supprimant côté SQL
                exists_clauses.append("REPLACE(REPLACE(LOWER(D1x.GDI_LIBELLE),' ',''),'-','') LIKE ?")
                exists_params.append(pat)
            elif _is_volume_size_token(str(taille)):
                # volumes parfum (50ml, 100 ml, 1l)
                exists_clauses.append("REPLACE(REPLACE(LOWER(D1x.GDI_LIBELLE),' ',''),'-','') LIKE ?")
                exists_params.append(_volume_like_param(str(taille)))  # "%50ml%"
            else:
                # fallback textuel
                exists_clauses.append("LOWER(D1x.GDI_LIBELLE) LIKE ?")
                exists_params.append(f"%{_canonize(str(taille)).replace(' ', '%')}%")
        if couleur:
            exists_clauses.append(
                "REPLACE(REPLACE(REPLACE(LOWER(D2x.GDI_LIBELLE),' ',''),'-',''),'/','') LIKE ?"
            )
            exists_params.append(_color_like_param(couleur))

        exists_sql = (" AND " + " AND ".join(exists_clauses)) if exists_clauses else ""
        header_extra += f"""
        AND EXISTS (
            SELECT 1
            FROM ARTICLE Ax
            LEFT JOIN DIMENSION D1x 
                   ON D1x.GDI_CODEDIM = Ax.GA_CODEDIM1 
                  AND D1x.GDI_TYPEDIM = 'DI1' 
                  AND D1x.GDI_GRILLEDIM = Ax.GA_GRILLEDIM1
            LEFT JOIN DIMENSION D2x 
                   ON D2x.GDI_CODEDIM = Ax.GA_CODEDIM2 
                  AND D2x.GDI_TYPEDIM = 'DI2' 
                  AND D2x.GDI_GRILLEDIM = Ax.GA_GRILLEDIM2
            WHERE Ax.GA_CODEARTICLE = A.GA_CODEARTICLE
            {exists_sql}
        )
        """
        header_params += exists_params

    header_sql = f"""
        SELECT TOP 1
            A.GA_CODEARTICLE,
            A.GA_LIBELLE,
            A.GA_PVTTC,
            A.GA_FAMILLENIV1,
            A.GA_FAMILLENIV2,
            A.GA_FAMILLENIV3,
            AIM.LO_OBJET AS IMAGE_BLOB
        FROM ARTICLE A
        LEFT JOIN ARTICLE_IMAGE_MODE AIM
               ON A.GA_CODEARTICLE = AIM.GA_CODEARTICLE
        WHERE A.GA_CODEARTICLE = ?
          AND {like_sql}
          {header_extra}
        ORDER BY A.GA_DATECREATION DESC
    """
    hdr = sql_cur.execute(header_sql, header_params).fetchone()
    if not hdr:
        return None

    # Variantes filtrées
    variants_params = [code_article]
    variants_extra = ""
    if taille:
        if "ans" in str(taille):
            taille_pat = _canonize(str(taille)).replace(" ", "%")
            variants_extra += " AND LOWER(D1.GDI_LIBELLE) LIKE ?"
            variants_params.append(f"%{taille_pat}%")
        elif _is_alpha_size_token(str(taille)):
            pat = _alpha_like_pattern(str(taille))
            variants_extra += " AND REPLACE(REPLACE(LOWER(D1.GDI_LIBELLE),' ',''),'-','') LIKE ?"
            variants_params.append(pat)
        elif _is_volume_size_token(str(taille)):
            variants_extra += " AND REPLACE(REPLACE(LOWER(D1.GDI_LIBELLE),' ',''),'-','') LIKE ?"
            variants_params.append(_volume_like_param(str(taille)))  # "%100ml%"
        else:
            variants_extra += " AND LOWER(D1.GDI_LIBELLE) LIKE ?"
            variants_params.append(f"%{_canonize(str(taille)).replace(' ', '%')}%")
    if couleur:
        variants_extra += (
            " AND REPLACE(REPLACE(REPLACE(LOWER(D2.GDI_LIBELLE),' ',''),'-',''),'/','') LIKE ?"
        )
        variants_params.append(_color_like_param(couleur))

    variants_sql = f"""
        SELECT 
            A.GA_ARTICLE,
            D1.GDI_LIBELLE AS taille,
            D2.GDI_LIBELLE AS couleur,
            D.GQ_DEPOT AS depot,
            ISNULL(D.GQ_PHYSIQUE, 0) AS quantite
        FROM ARTICLE A
        LEFT JOIN DISPO D
               ON D.GQ_ARTICLE = A.GA_ARTICLE
        LEFT JOIN DIMENSION D1 
               ON D1.GDI_CODEDIM = A.GA_CODEDIM1 
              AND D1.GDI_TYPEDIM = 'DI1' 
              AND D1.GDI_GRILLEDIM = A.GA_GRILLEDIM1
        LEFT JOIN DIMENSION D2 
               ON D2.GDI_CODEDIM = A.GA_CODEDIM2 
              AND D2.GDI_TYPEDIM = 'DI2' 
              AND D2.GDI_GRILLEDIM = A.GA_GRILLEDIM2
        WHERE A.GA_CODEARTICLE = ?
          {variants_extra}
        ORDER BY taille, couleur, depot
    """
    rows = sql_cur.execute(variants_sql, variants_params).fetchall()

    variantes = []
    quantite_totale = 0
    for r in rows:
        variantes.append({
            "GA_ARTICLE": r.GA_ARTICLE,
            "taille": getattr(r, "taille", None),
            "couleur": getattr(r, "couleur", None),
            "depot": getattr(r, "depot", None)
        })
        try:
            quantite_totale += int(getattr(r, "quantite", 0) or 0)
        except Exception:
            pass

    image_b64 = _blob_to_data_uri(getattr(hdr, "IMAGE_BLOB", None), mime="image/jpeg")

    return {
        "GA_CODEARTICLE": hdr.GA_CODEARTICLE,
        "GA_LIBELLE": hdr.GA_LIBELLE,
        "GA_PVTTC": float(hdr.GA_PVTTC or 0),
        "GA_FAMILLENIV1": getattr(hdr, "GA_FAMILLENIV1", None),
        "GA_FAMILLENIV2": getattr(hdr, "GA_FAMILLENIV2", None),
        "GA_FAMILLENIV3": getattr(hdr, "GA_FAMILLENIV3", None),
        "IMAGE": image_b64,
        "QUANTITE_TOTALE": quantite_totale,
        "variantes": variantes
    }

# ------------------------------------------------------------
# Endpoint principal
# ------------------------------------------------------------
@app.route('/match-mot', methods=['POST'])
def match_mot():
    data = request.get_json(silent=True) or {}
    user_mot = data.get("mot")
    if not user_mot:
        return jsonify({"error": "Champ 'mot' requis"}), 400

    try:
        keywords = _keywords(user_mot)
        taille, couleur, budget = parse_criteria(user_mot)

        # Recherche sémantique (diversité)
        mmr_docs = vectordb.max_marginal_relevance_search(
            query=user_mot,
            k=120,
            fetch_k=400,
            lambda_mult=0.2
        )

        seen = set()
        ordered_codes = []
        for d in mmr_docs:
            code = (d.metadata or {}).get("code_article")
            if code and code not in seen:
                seen.add(code)
                ordered_codes.append(code)

        payload = []
        for code in ordered_codes:
            art = fetch_article_with_variants_filtered(code, keywords, taille, couleur, budget)
            if art:
                payload.append(art)
            if len(payload) >= 20:
                break

        return jsonify(payload), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ------------------------------------------------------------
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=False)
