import sys
import json
import spacy

nlp = spacy.load("fr_core_news_md")

def extract_products(text):
    doc = nlp(text)
    products = []
    for ent in doc.ents:
        if ent.label_ == "PRODUCT":  # Using PRODUCT label, you might need to train or adjust for better results
            products.append(ent.text)
    return products

if __name__ == "__main__":
    text = sys.argv[1]
    products = extract_products(text)
    print(json.dumps(products))
