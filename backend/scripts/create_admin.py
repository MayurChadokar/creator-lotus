"""Create or reset an administrator using values supplied through the environment."""
import json
import os

import pymysql


connection = pymysql.connect(
    host=os.environ["MYSQL_HOST"],
    port=int(os.environ.get("MYSQL_PORT", "3306")),
    user=os.environ["MYSQL_USER"],
    password=os.environ["MYSQL_PASSWORD"],
    database=os.environ["MYSQL_DATABASE"],
    autocommit=True,
)
try:
    with connection.cursor() as cursor:
        cursor.execute(
            """INSERT INTO users (role,full_name,email,password_hash,is_active,must_change_password)
               VALUES ('ADMIN','Platform Admin',%s,%s,1,0)
               ON DUPLICATE KEY UPDATE role='ADMIN',full_name='Platform Admin',
                 password_hash=VALUES(password_hash),is_active=1,must_change_password=0,
                 token_version=token_version+1""",
            (os.environ["ADMIN_EMAIL"], os.environ["ADMIN_HASH"]),
        )
        cursor.execute(
            "SELECT id,email,role,is_active FROM users WHERE email=%s",
            (os.environ["ADMIN_EMAIL"],),
        )
        row = cursor.fetchone()
        print(json.dumps({"id": row[0], "email": row[1], "role": row[2], "active": bool(row[3])}))
finally:
    connection.close()
