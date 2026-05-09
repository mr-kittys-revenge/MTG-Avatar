#!/usr/bin/env python3
"""Fetch all Avatar: The Last Airbender card printings from Scryfall."""
import json
import time
import urllib.request
import urllib.error
from pathlib import Path

SETS = ["tla", "tle", "ptla", "jtla", "ttla", "atle", "ftla", "atla", "ttle"]
HEADERS = {"User-Agent": "MTGAvatarTracker/1.0", "Accept": "application/json"}
OUT = Path(__file__).resolve().parent.parent / "cards.json"


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def pick_image(card, key):
    if card.get("image_uris"):
        return card["image_uris"].get(key)
    faces = card.get("card_faces") or []
    if faces and faces[0].get("image_uris"):
        return faces[0]["image_uris"].get(key)
    return None


def face_text(c, key):
    if c.get(key) is not None:
        return c.get(key)
    faces = c.get("card_faces") or []
    if faces:
        return " // ".join(f.get(key, "") for f in faces if f.get(key))
    return ""


def slim(c):
    return {
        "id": c["id"],
        "oracle_id": c.get("oracle_id"),
        "name": c["name"],
        "set": c["set"],
        "set_name": c["set_name"],
        "collector_number": c["collector_number"],
        "rarity": c["rarity"],
        "colors": c.get("colors") or (c.get("card_faces", [{}])[0].get("colors") if c.get("card_faces") else []),
        "color_identity": c.get("color_identity", []),
        "type_line": face_text(c, "type_line"),
        "mana_cost": face_text(c, "mana_cost"),
        "cmc": c.get("cmc", 0),
        "oracle_text": face_text(c, "oracle_text"),
        "flavor_text": face_text(c, "flavor_text"),
        "power": face_text(c, "power"),
        "toughness": face_text(c, "toughness"),
        "loyalty": face_text(c, "loyalty"),
        "keywords": c.get("keywords", []),
        "image_small": pick_image(c, "small"),
        "image_normal": pick_image(c, "normal"),
        "image_art_crop": pick_image(c, "art_crop"),
        "finishes": c.get("finishes", ["nonfoil"]),
        "frame_effects": c.get("frame_effects", []),
        "promo_types": c.get("promo_types", []),
        "border_color": c.get("border_color", "black"),
        "lang": c.get("lang", "en"),
        "scryfall_uri": c.get("scryfall_uri"),
    }


def main():
    all_cards = []
    for set_code in SETS:
        url = f"https://api.scryfall.com/cards/search?q=e%3A{set_code}&unique=prints&order=set"
        page = 1
        set_count = 0
        while url:
            try:
                data = fetch(url)
            except urllib.error.HTTPError as e:
                print(f"  ! {set_code} page {page}: HTTP {e.code}")
                break
            for c in data["data"]:
                all_cards.append(slim(c))
                set_count += 1
            url = data.get("next_page") if data.get("has_more") else None
            page += 1
            time.sleep(0.1)
        print(f"  {set_code}: {set_count} cards")

    print(f"\nTotal: {len(all_cards)} printings")
    OUT.write_text(json.dumps(all_cards, separators=(",", ":")))
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
