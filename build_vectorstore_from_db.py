# build_vectorstore_from_db.py
import os
import pyodbc
from dotenv import load_dotenv
from langchain.vectorstores import Chroma
from langchain.embeddings import HuggingFaceEmbeddings
from langchain.schema import Document

# ------------------------------------------------------------
# Chargement env + connexion SQL Server
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

conn = pyodbc.connect(connection_string)
cursor = conn.cursor()

# ------------------------------------------------------------
# Récupération des variantes pour alimenter le vector store
# (on n'inclut PAS l'image ni les quantités ici pour éviter des gros blobs)
# ------------------------------------------------------------
query = """
SELECT 
    A.GA_ARTICLE,
    A.GA_CODEARTICLE,
    A.GA_LIBELLE,
    D1.GDI_LIBELLE AS TAILLE,
    D2.GDI_LIBELLE AS COULEUR,
    A.GA_PVTTC
FROM ARTICLE A
LEFT JOIN DIMENSION D1 
    ON D1.GDI_CODEDIM = A.GA_CODEDIM1 
   AND D1.GDI_TYPEDIM = 'DI1' 
   AND D1.GDI_GRILLEDIM = A.GA_GRILLEDIM1
LEFT JOIN DIMENSION D2 
    ON D2.GDI_CODEDIM = A.GA_CODEDIM2 
   AND D2.GDI_TYPEDIM = 'DI2' 
   AND D2.GDI_GRILLEDIM = A.GA_GRILLEDIM2
"""
rows = cursor.execute(query).fetchall()

documents = []
for row in rows:
    code_article = row.GA_CODEARTICLE or ""
    libelle = row.GA_LIBELLE or ""
    taille = row.TAILLE or "Non spécifiée"
    couleur = row.COULEUR or "Non spécifiée"
    prix = float(row.GA_PVTTC or 0.0)

    # Texte riche pour bien matcher les requêtes naturelles
    phrase = f"Article: {libelle} | Taille: {taille} | Couleur: {couleur} | Prix: {prix:.2f} €"

    doc = Document(
        page_content=phrase,
        metadata={
            "code_article": code_article,
            "libelle": libelle,
            "taille": taille,
            "couleur": couleur,
            "prix": prix,
        },
    )
    documents.append(doc)

# ------------------------------------------------------------
# Embeddings + VectorStore (Chroma persistant)
# ------------------------------------------------------------
embedding_model = HuggingFaceEmbeddings(
    model_name="intfloat/multilingual-e5-small",
    cache_folder="embeddings_model"
)

vectordb = Chroma.from_documents(
    documents=documents,
    embedding=embedding_model,
    persist_directory="persist_directory_match"
)

vectordb.persist()
print("✅ Base vectorielle créée avec succès depuis la base SQL !")

cursor.close()
conn.close()
