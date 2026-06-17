import json

import pandas as pd
from tqdm import tqdm

from supabase_client import supabase_client


def remove_empty_values(data_dict):
    return {k: v for k, v in data_dict.items() if pd.notna(v) and v != "" and v is not None}


def insert_venue_data(fp):
    df = pd.read_csv(fp, header=0)
    df["rank"] = df["rank"].apply(lambda x: x.strip() if isinstance(x, str) else x)

    category_data = {
        "category_name": "CCF",
        "category_description": "CCF推荐国际会议和期刊目录（2022版）",
        "discipline": "计算机科学技术",
        "rank_list": json.dumps([rank.strip() if isinstance(rank, str) else rank for rank in pd.unique(df["rank"]).tolist()]),
    }
    category_data = remove_empty_values(category_data)

    try:
        category_result = supabase_client.table("categories").upsert(category_data).execute()
        category_id = category_result.data[0]["id"]
    except Exception as e:
        print(f"插入类别时出错: {e}")
        existing_category = supabase_client.table("categories").select("id").eq("category_name", "CCF").execute()
        if existing_category.data:
            category_id = existing_category.data[0]["id"]
            supabase_client.table("categories").update(category_data).eq("id", category_id).execute()
        else:
            raise e

    for _, row in tqdm(df.iterrows(), total=len(df)):
        venue_data = {
            "venue_name": row["venue_name"],
            "publisher": row["publisher"],
        }
        if pd.notna(row["venue_abbr"]):
            venue_data["venue_abbr"] = row["venue_abbr"]

        venue_url = row["venue_url"]
        if pd.notna(venue_url):
            if "dblp" in venue_url:
                venue_data["dblp_url"] = venue_url
            else:
                venue_data["venue_url"] = venue_url

        venue_data = remove_empty_values(venue_data)
        venue_id = None

        if pd.notna(row["dblp_key"]):
            existing_venue = supabase_client.table("venues").select("id").eq("dblp_detail_key", row["dblp_key"]).execute()
            if existing_venue.data:
                venue_id = existing_venue.data[0]["id"]
                supabase_client.table("venues").update(venue_data).eq("id", venue_id).execute()
            else:
                venue_data["dblp_detail_key"] = row["dblp_key"]
                new_venue = supabase_client.table("venues").insert(venue_data).execute()
                if new_venue.data:
                    venue_id = new_venue.data[0]["id"]
                else:
                    print(f"无法插入新venue记录: {row['dblp_key']}")
                    continue

        if venue_id and category_id:
            ranking_data = {
                "category_id": category_id,
                "venue_id": venue_id,
                "rank": row["rank"],
            }
            ranking_data = remove_empty_values(ranking_data)
            existing_ranking = supabase_client.table("category_venue_rankings").select("id").match({
                "category_id": category_id,
                "venue_id": venue_id,
            }).execute()
            if existing_ranking.data:
                supabase_client.table("category_venue_rankings").update(ranking_data).eq("id", existing_ranking.data[0]["id"]).execute()
            else:
                supabase_client.table("category_venue_rankings").insert(ranking_data).execute()


if __name__ == "__main__":
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser(description="Import CCF venue rankings into Supabase.")
    parser.add_argument(
        "csv",
        nargs="?",
        default=str(Path(__file__).resolve().parents[1] / "ccf_2022_with_dblp_key.csv"),
        help="Path to ccf_2022_with_dblp_key.csv",
    )
    args = parser.parse_args()
    insert_venue_data(args.csv)
    print("数据插入完成")
