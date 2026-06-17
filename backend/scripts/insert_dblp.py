import argparse
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timezone

from lxml import etree
from tqdm import tqdm

from supabase_client import supabase_client


def existing_file(filename: str) -> str:
    if os.path.isfile(filename):
        return filename
    raise argparse.ArgumentTypeError("%s is not a valid input file!" % filename)


def parse_args():
    parser = argparse.ArgumentParser(description="Parse the DBLP XML file and insert to Supabase")
    parser.add_argument("--xml_filename", type=existing_file, default="./dblp/dblp.xml")
    parser.add_argument("--dtd_filename", type=existing_file, default="./dblp/dblp.dtd")
    return parser.parse_args()


def extract_key_layers(key, layers=2):
    parts = key.split("/")
    return "/".join(parts[:layers]) if len(parts) >= layers else key


def sanitize_string(s):
    if not s:
        return s
    s = re.sub(r"[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]", "", s)
    s = s.replace('"', "'")
    s = re.sub(r"\s{5,}", " ", s)
    return s.strip()


def get_element_text(element):
    if element is None:
        return ""
    texts = []
    for text in element.itertext():
        if text:
            cleaned_text = text.strip()
            if cleaned_text:
                texts.append(cleaned_text)
    return re.sub(r"\s+", " ", " ".join(texts)).strip()


def sanitize_for_json(data):
    if isinstance(data, dict):
        return {k: sanitize_for_json(v) for k, v in data.items()}
    if isinstance(data, list):
        return [sanitize_for_json(item) for item in data]
    if isinstance(data, str):
        return sanitize_string(data)
    return data


def clean_record(record):
    if record is None:
        return {}
    return {k: v for k, v in record.items() if v is not None}


def safe_json_dumps(data):
    try:
        cleaned_data = sanitize_for_json(data)
        return json.dumps(cleaned_data, ensure_ascii=False)
    except Exception as e:
        print(f"JSON serialization error: {e}, data: {str(data)[:200]}")
        return "{}"


def chunks(items, size=200):
    for index in range(0, len(items), size):
        yield items[index:index + size]


class DBLPProcessor:
    def __init__(self):
        self.venue_cache = {}
        self.ready_top_venues = {}
        self.pending_sub_venues = {}
        self.ready_papers = []
        self.pending_papers = defaultdict(list)
        self.batch_size = int(os.getenv("DBLP_BATCH_SIZE", "100"))

    def get_venue_id_by_dblp_detail_key(self, dblp_detail_key):
        if dblp_detail_key in self.venue_cache:
            return self.venue_cache[dblp_detail_key]
        try:
            response = supabase_client.table("venues").select("id").eq("dblp_detail_key", dblp_detail_key).execute()
            if response.data and len(response.data) > 0:
                venue_id = response.data[0]["id"]
                self.venue_cache[dblp_detail_key] = venue_id
                return venue_id
            self.venue_cache[dblp_detail_key] = None
            return None
        except Exception as e:
            print(f"Error getting venue id for '{dblp_detail_key}': {e}")
            return None

    def backfill_venue_name(self, dblp_detail_key, venue_name):
        venue_name = sanitize_string(venue_name or "")
        if not dblp_detail_key or not venue_name:
            return
        try:
            supabase_client.table("venues").update({"venue_name": venue_name}).eq(
                "dblp_detail_key", dblp_detail_key
            ).or_("venue_name.is.null,venue_name.eq.").execute()
        except Exception as e:
            print(f"Error backfilling venue name for '{dblp_detail_key}': {e}")

    def fetch_existing_venues(self, dblp_detail_keys):
        keys = [key for key in dict.fromkeys(dblp_detail_keys) if key]
        existing = {}
        for batch in chunks(keys):
            response = supabase_client.table("venues").select("id,dblp_detail_key").in_(
                "dblp_detail_key", batch
            ).execute()
            for row in response.data or []:
                key = row.get("dblp_detail_key")
                venue_id = row.get("id")
                if key and venue_id:
                    existing[key] = venue_id
                    self.venue_cache[key] = venue_id
        return existing

    def fetch_existing_paper_keys(self, dblp_keys):
        keys = [key for key in dict.fromkeys(dblp_keys) if key]
        existing = set()
        for batch in chunks(keys):
            response = supabase_client.table("papers").select("dblp_key").in_("dblp_key", batch).execute()
            existing.update(row.get("dblp_key") for row in response.data or [] if row.get("dblp_key"))
        return existing

    def insert_venues_batch(self, venues_batch):
        try:
            if not venues_batch:
                return {}
            venue_to_insert = []
            for venue in venues_batch:
                venue_clean = clean_record(venue)
                if venue_clean:
                    venue_to_insert.append(venue_clean)
            if not venue_to_insert:
                return {}

            existing = self.fetch_existing_venues([venue.get("dblp_detail_key") for venue in venue_to_insert])
            missing_venues = [
                venue for venue in venue_to_insert
                if venue.get("dblp_detail_key") and venue.get("dblp_detail_key") not in existing
            ]
            if not missing_venues:
                return existing

            response = supabase_client.table("venues").upsert(
                missing_venues,
                on_conflict="dblp_detail_key",
                ignore_duplicates=True,
            ).execute()
            if hasattr(response, "error") and response.error:
                print(f"Error inserting venues batch: {response.error}")
                raise RuntimeError(response.error)

            id_mapping = dict(existing)
            if response.data:
                for venue_data in response.data:
                    dblp_detail_key = venue_data.get("dblp_detail_key")
                    venue_id = venue_data.get("id")
                    if dblp_detail_key and venue_id:
                        id_mapping[dblp_detail_key] = venue_id
                        self.venue_cache[dblp_detail_key] = venue_id
            return id_mapping
        except Exception as e:
            print(f"Exception during venues batch insert: {e}")
            print(f"Batch size: {len(venues_batch)}")
            raise

    def insert_papers_batch(self, papers_batch):
        try:
            if not papers_batch:
                return
            papers_to_insert = []
            for paper in papers_batch:
                paper_clean = clean_record(paper)
                if not paper_clean:
                    continue
                papers_to_insert.append(paper_clean)
            if not papers_to_insert:
                return
            for i in range(0, len(papers_to_insert), self.batch_size):
                batch = papers_to_insert[i:i + self.batch_size]
                existing_keys = self.fetch_existing_paper_keys([paper.get("dblp_key") for paper in batch])
                batch = [paper for paper in batch if paper.get("dblp_key") and paper.get("dblp_key") not in existing_keys]
                if not batch:
                    continue
                response = supabase_client.table("papers").upsert(
                    batch,
                    on_conflict="dblp_key",
                    ignore_duplicates=True,
                ).execute()
                if hasattr(response, "error") and response.error:
                    print(f"Error inserting papers batch: {response.error}")
                    raise RuntimeError(response.error)
        except Exception as e:
            print(f"Exception during papers batch insert: {e}")
            raise

    def flush_venues_batch(self):
        id_mapping = {}
        sub_id_mapping = {}
        if self.ready_top_venues:
            id_mapping = self.insert_venues_batch(list(self.ready_top_venues.values()))

        sub_venues_to_insert = []
        if self.pending_sub_venues:
            for key, value in self.pending_sub_venues.items():
                main_venue_id = self.get_venue_id_by_dblp_detail_key(value["dblp_key"])
                if main_venue_id:
                    value["main_venue_id"] = main_venue_id
                    sub_venues_to_insert.append(value)
                else:
                    print(f"Warning: Main venue id not found for top_key: {key}")
        if sub_venues_to_insert:
            sub_id_mapping = self.insert_venues_batch(sub_venues_to_insert)

        all_id_mapping = {**id_mapping, **sub_id_mapping}
        if len(self.pending_papers) > 0 and all_id_mapping:
            self.process_pending_papers(all_id_mapping)

        for key in list(id_mapping.keys()):
            self.ready_top_venues.pop(key, None)
        for key in list(sub_id_mapping.keys()):
            self.pending_sub_venues.pop(key, None)

    def process_pending_papers(self, venue_cache):
        processed_keys = []
        for venue_key, papers in self.pending_papers.items():
            venue_id = venue_cache.get(venue_key, None)
            if venue_id:
                for paper in papers:
                    paper["ref_venue"] = venue_id
                    self.ready_papers.append(paper)
                if len(self.ready_papers) >= self.batch_size:
                    self.insert_papers_batch(self.ready_papers)
                    self.ready_papers.clear()
                processed_keys.append(venue_key)
        for venue_key in processed_keys:
            del self.pending_papers[venue_key]

    def flush_papers_batch(self):
        if len(self.pending_papers) > 0:
            self.process_pending_papers(self.venue_cache)
        if self.ready_papers:
            self.insert_papers_batch(self.ready_papers)
            self.ready_papers.clear()

    def should_process_element(self, elem, key):
        arxiv_label = "journals/corr"
        if elem.tag not in ["article", "inproceedings", "proceedings"]:
            return False
        for child in elem:
            if child.tag == "crossref":
                if child.text and child.text.startswith(arxiv_label):
                    return False
        if key.startswith(arxiv_label):
            return False
        return key.startswith("journals/") or key.startswith("conf/")

    def process_venue_element(self, elem, key):
        top_key = extract_key_layers(key, 2)
        joc = 0 if key.startswith("journals/") else 1
        if top_key not in self.ready_top_venues and not self.venue_cache.get(top_key):
            self.ready_top_venues[top_key] = {
                "joc": joc,
                "dblp_key": top_key,
                "dblp_detail_key": top_key,
            }
        if elem.tag == "proceedings":
            if key not in self.pending_sub_venues and not self.venue_cache.get(key):
                sub_venue_record = {
                    "joc": joc,
                    "dblp_key": top_key,
                    "dblp_detail_key": key,
                }
                self.pending_sub_venues[key] = self.extract_venue_info(elem, sub_venue_record)
        if len(self.ready_top_venues) + len(self.pending_sub_venues) >= self.batch_size / 10:
            self.flush_venues_batch()

    def extract_venue_info(self, elem, venue_record):
        venue_details = {}
        for child in elem:
            if child.tag == "title" and child.text:
                title = get_element_text(child)
                title = sanitize_string(title)
                if title:
                    venue_record["venue_name"] = title
            elif child.tag == "booktitle" and child.text and not venue_record.get("venue_name"):
                venue_record["venue_name"] = child.text
            elif child.tag == "journal" and child.text and not venue_record.get("venue_name"):
                venue_record["venue_name"] = child.text
            elif child.text and child.tag:
                if child.tag in venue_details:
                    if not isinstance(venue_details[child.tag], list):
                        venue_details[child.tag] = [venue_details[child.tag]]
                    venue_details[child.tag].append(child.text)
                else:
                    venue_details[child.tag] = child.text
        for attr_name, attr_value in elem.attrib.items():
            venue_details[attr_name] = attr_value
        if venue_details:
            venue_record["venue_details"] = safe_json_dumps(venue_details)
        return venue_record

    def process_paper_element(self, elem, key):
        if elem.tag == "article":
            ref_venue = extract_key_layers(key, 2)
        else:
            crossref = None
            for child in elem:
                if child.tag == "crossref" and child.text:
                    crossref = child.text
                    break
            ref_venue = crossref or extract_key_layers(key, 2)
        paper_record = self.extract_paper_info(elem, {})
        if "title" not in paper_record:
            print(f"Error: No title found for paper {key}")
            return
        details = paper_record.get("paper_details") or {}
        if isinstance(details, dict):
            self.backfill_venue_name(ref_venue, details.get("journal") or details.get("booktitle"))
        venue_id = self.get_venue_id_by_dblp_detail_key(ref_venue)
        if venue_id:
            paper_record["ref_venue"] = venue_id
            self.ready_papers.append(paper_record)
            if len(self.ready_papers) >= self.batch_size:
                self.flush_papers_batch()
        else:
            self.pending_papers[ref_venue].append(paper_record)

    def extract_paper_info(self, elem, paper_record):
        paper_details = {}
        authors = []
        key = elem.attrib.get("key")
        paper_record["dblp_key"] = key
        for child in elem:
            if child.tag == "title":
                title = get_element_text(child)
                title = sanitize_string(title)
                if title:
                    if len(title) > 2000:
                        print(title)
                        title = title[:2000]
                    paper_record["title"] = title
            elif child.tag == "author" and child.text:
                authors.append(child.text)
            elif child.tag == "year" and child.text:
                try:
                    paper_record["pub_year"] = int(child.text)
                except ValueError:
                    pass
            elif child.tag == "ee":
                if child.text:
                    if "doi" in child.text.lower():
                        if "doi_url" not in paper_record:
                            paper_record["doi_url"] = child.text
                    else:
                        if "pub_url" not in paper_record and "wikidata" not in child.text.lower():
                            paper_record["pub_url"] = child.text
            else:
                if child.text:
                    if child.tag in paper_details:
                        if not isinstance(paper_details[child.tag], list):
                            paper_details[child.tag] = [paper_details[child.tag]]
                        paper_details[child.tag].append(child.text)
                    else:
                        paper_details[child.tag] = child.text
        if authors:
            paper_record["authors"] = authors
        if paper_details:
            paper_record["paper_details"] = paper_details
        return paper_record

    def process_dblp_xml(self, xml_file):
        context = etree.iterparse(xml_file, events=("start", "end"), load_dtd=True, recover=True)
        context = iter(context)
        _, root = next(context)
        pbar = tqdm(context, desc="Processing DBLP data")
        for event, elem in pbar:
            if event == "end":
                try:
                    key = elem.attrib.get("key")
                    if not key:
                        continue
                    if not self.should_process_element(elem, key):
                        continue
                    self.process_venue_element(elem, key)
                    if elem.tag in ["article", "inproceedings"]:
                        self.process_paper_element(elem, key)
                except Exception as e:
                    if hasattr(elem, "attrib") and "key" in elem.attrib:
                        print(f"Error processing element {elem.attrib.get('key')} ({elem.tag}): {e}")
                    else:
                        print(f"Error processing element: {e}")
                    continue
                pbar.set_description(
                    f"Processing DBLP data (pending papers: {len(self.pending_papers)}, "
                    f"pending venues: {len(self.pending_sub_venues)}, venue cache: {len(self.venue_cache)})"
                )
                root.clear()
        self.flush_venues_batch()
        self.flush_papers_batch()
        print("\nProcessing complete:")
        print(f"  Venue cache size: {len(self.venue_cache)}")
        print(f"  Pending papers: {len(self.pending_papers)}")


def parse_and_insert_dblp(xml_filename, dtd_filename=None):
    print("Starting to process DBLP XML file...")
    processor = DBLPProcessor()
    processor.process_dblp_xml(xml_filename)
    supabase_client.table("app_metadata").upsert(
        {
            "key": "dblp_last_inserted_at",
            "value_json": {"inserted_at": datetime.now(timezone.utc).isoformat()},
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="key",
    ).execute()
    print("Finished processing DBLP XML file.")


def main():
    args = parse_args()
    if args.xml_filename and args.dtd_filename:
        parse_and_insert_dblp(args.xml_filename, args.dtd_filename)
    else:
        print("Invalid input arguments.")


if __name__ == "__main__":
    main()
