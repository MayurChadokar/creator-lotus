"""Initialize MySQL 8 from the canonical schema and MySQL seed files."""
from __future__ import annotations

import os
import re
from pathlib import Path

import pymysql
from pymysql.constants import CLIENT


ROOT = Path(__file__).resolve().parents[1]


def mysql_schema(source: str) -> str:
    source = source.split("CREATE FUNCTION forbid_audit_change()")[0]
    replacements = [
        (r"^.*PostgreSQL 14\+.*$", "-- MySQL 8.0+"),
        (r"^CREATE EXTENSION[^;]+;\s*", ""),
        (r"\brank\b", "`rank`"),
        (r"\bTEXT\[\]", "JSON"),
        (r"\bUUID\b", "CHAR(36)"),
        (r"\bTIMESTAMPTZ\b", "DATETIME(3)"),
        (r"\bDOUBLE PRECISION\b", "DOUBLE"),
        (r"\bBIGSERIAL\b", "BIGINT AUTO_INCREMENT"),
        (r"\bJSONB\b", "JSON"),
        (r"JSON NOT NULL DEFAULT '\{\}'", "JSON NOT NULL DEFAULT (JSON_OBJECT())"),
        (r"DEFAULT\s+'\{\}'", "DEFAULT (JSON_ARRAY())"),
        (r"DEFAULT\s+gen_random_uuid\(\)", "DEFAULT (UUID())"),
        (r"DEFAULT\s+now\(\)", "DEFAULT CURRENT_TIMESTAMP(3)"),
        (r"\bBOOLEAN\b", "TINYINT(1)"),
        (r"DEFAULT TRUE", "DEFAULT 1"),
        (r"DEFAULT FALSE", "DEFAULT 0"),
        (r"\bTEXT\b", "VARCHAR(255)"),
        (r"REFERENCES\s+([^\s,]+)\s+UNIQUE", r"UNIQUE REFERENCES \1"),
        (r"(\bbody|\bbrief|\bdescription|\bposting_guidelines|\bstatus_reason|\bresolution_note|\bdecision_note|\breason|\bdetails)\s+VARCHAR\(255\)", r"\1 TEXT"),
        (r"CHECK \(start_time ~ '[^']+'\)", "CHECK (start_time REGEXP '^([01][0-9]|2[0-3]):[0-5][0-9]$')"),
        (r"CHECK \(end_time ~ '[^']+'\)", "CHECK (end_time REGEXP '^([01][0-9]|2[0-3]):[0-5][0-9]$')"),
    ]
    for pattern, replacement in replacements:
        source = re.sub(pattern, replacement, source, flags=re.I | re.M)
    source = re.sub(r"(^\s*)key(\s+VARCHAR\(255\))", r"\1`key`\2", source, flags=re.I | re.M)
    source = re.sub(r"\(key,", "(`key`,", source, flags=re.I)
    for name in (
        "one_current_legal_document", "one_submission_per_post",
        "one_live_earning_per_submission", "one_open_ad_right",
        "one_live_item_per_earning", "one_visit_per_creator_slot",
    ):
        source = re.sub(rf"CREATE UNIQUE INDEX {name}[\s\S]*?;\s*", "", source)
    source = re.sub(r"CREATE INDEX tds_ledger_year_idx[\s\S]*?;\s*", "CREATE INDEX tds_ledger_year_idx ON tds_ledger (influencer_id, tax_year);\n", source)
    source = re.sub(r"CREATE INDEX benefit_year_idx[\s\S]*?;\s*", "CREATE INDEX benefit_year_idx ON benefit_records (influencer_id, tax_year);\n", source)
    return source


def run_multi(cursor, sql: str) -> None:
    cursor.execute(sql)
    while cursor.nextset():
        pass


def main() -> None:
    connection = pymysql.connect(
        host=os.environ["MYSQL_HOST"],
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ["MYSQL_USER"],
        password=os.environ["MYSQL_PASSWORD"],
        database=os.environ["MYSQL_DATABASE"],
        charset="utf8mb4",
        autocommit=True,
        client_flag=CLIENT.MULTI_STATEMENTS,
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()")
            if cursor.fetchone()[0]:
                raise RuntimeError("Target database is not empty; setup stopped without making changes")
            schema = mysql_schema((ROOT / "db" / "schema.sql").read_text(encoding="utf-8"))
            run_multi(cursor, schema)
            triggers = (ROOT / "db" / "schema.mysql.triggers.sql").read_text(encoding="utf-8")
            blocks = re.split(r"(?=CREATE TRIGGER)", re.sub(r"(?m)^--.*$", "", triggers))
            for block in blocks:
                if block.strip():
                    cursor.execute(block.strip().rstrip(";"))
            run_multi(cursor, (ROOT / "db" / "seed.mysql.sql").read_text(encoding="utf-8"))
            cursor.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()")
            table_count = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM tiers")
            tiers = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM product_categories")
            categories = cursor.fetchone()[0]
            print(f"Database initialized: tables={table_count}, tiers={tiers}, categories={categories}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
