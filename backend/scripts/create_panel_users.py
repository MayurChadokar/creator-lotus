"""Create or reset local demo accounts for the manager and creator panels."""
import json
import os

import pymysql


connection = pymysql.connect(
    host=os.environ["MYSQL_HOST"],
    port=int(os.environ.get("MYSQL_PORT", "3306")),
    user=os.environ["MYSQL_USER"],
    password=os.environ["MYSQL_PASSWORD"],
    database=os.environ["MYSQL_DATABASE"],
    autocommit=False,
)
try:
    with connection.cursor() as cursor:
        cursor.execute(
            """INSERT INTO stores (code,name,city,state,latitude,longitude,is_active)
               VALUES ('DEMO-INDORE','Lotus Demo Store','Indore','Madhya Pradesh',22.7196,75.8577,1)
               ON DUPLICATE KEY UPDATE name=VALUES(name),city=VALUES(city),state=VALUES(state),
                 latitude=VALUES(latitude),longitude=VALUES(longitude),is_active=1"""
        )
        cursor.execute("SELECT id FROM stores WHERE code='DEMO-INDORE'")
        store_id = cursor.fetchone()[0]

        cursor.execute(
            """INSERT INTO users (role,full_name,email,password_hash,store_id,is_active,must_change_password)
               VALUES ('STORE_MANAGER','Demo Store Manager',%s,%s,%s,1,0)
               ON DUPLICATE KEY UPDATE role='STORE_MANAGER',full_name=VALUES(full_name),
                 password_hash=VALUES(password_hash),store_id=VALUES(store_id),is_active=1,
                 must_change_password=0,token_version=token_version+1""",
            (os.environ["MANAGER_EMAIL"], os.environ["MANAGER_HASH"], store_id),
        )

        cursor.execute(
            """INSERT INTO users (role,full_name,email,password_hash,is_active,must_change_password)
               VALUES ('INFLUENCER','Demo Creator',%s,%s,1,0)
               ON DUPLICATE KEY UPDATE role='INFLUENCER',full_name=VALUES(full_name),
                 password_hash=VALUES(password_hash),is_active=1,must_change_password=0,
                 token_version=token_version+1""",
            (os.environ["CREATOR_EMAIL"], os.environ["CREATOR_HASH"]),
        )
        cursor.execute("SELECT id FROM users WHERE email=%s", (os.environ["CREATOR_EMAIL"],))
        creator_id = cursor.fetchone()[0]
        cursor.execute("SELECT id FROM tiers WHERE name='Nano'")
        tier_id = cursor.fetchone()[0]
        cursor.execute(
            """INSERT INTO influencer_profiles
                 (user_id,tier_id,city,latitude,longitude,vetting_status,home_store_id,privacy_accepted_at)
               VALUES (%s,%s,'Indore',22.7196,75.8577,'APPROVED',%s,NOW())
               ON DUPLICATE KEY UPDATE tier_id=VALUES(tier_id),city=VALUES(city),
                 latitude=VALUES(latitude),longitude=VALUES(longitude),vetting_status='APPROVED',
                 home_store_id=VALUES(home_store_id),is_blacklisted=0""",
            (creator_id, tier_id, store_id),
        )
        connection.commit()
        print(json.dumps({"store_id": store_id, "creator_id": creator_id, "status": "ready"}))
except Exception:
    connection.rollback()
    raise
finally:
    connection.close()
