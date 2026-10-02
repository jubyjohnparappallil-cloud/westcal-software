import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import type { Platform } from "./app.js";
import { SEED_COURSES } from "./modules/training/courses.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, "..", "data");
export const DATA_FILE = join(DATA_DIR, "platform.json");
export const MYSQL_HOST = process.env.MYSQL_HOST || "127.0.0.1";
export const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3307);
export const MYSQL_USER = process.env.MYSQL_USER || "root";
export const MYSQL_DATABASE = process.env.MYSQL_DATABASE || "westcal";

interface SavedState {
  version: number;
  savedAt?: string;
  training?: ReturnType<Platform["training"]["exportSnapshot"]>;
  users?: ReturnType<Platform["users"]["exportSnapshot"]>;
  userPermissions?: ReturnType<Platform["permissions"]["exportUserPermissionGrants"]>;
  extraCourses?: Array<{ name: string; description?: string }>;
}

let pool: Pool | null = null;

function mysqlPassword(): string {
  return process.env.MYSQL_PASSWORD ?? "";
}

async function database(): Promise<Pool> {
  if (pool) return pool;
  const admin = await mysql.createConnection({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: mysqlPassword(),
    multipleStatements: true,
  });
  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.query("SET GLOBAL max_allowed_packet = 67108864").catch(() => undefined);
  await admin.end();
  const next = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: mysqlPassword(),
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 4,
    charset: "utf8mb4",
  });
  const tables = [
    `CREATE TABLE IF NOT EXISTS meta (
      \`key\` VARCHAR(64) PRIMARY KEY,
      value VARCHAR(255) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      identifier VARCHAR(255) NOT NULL,
      email VARCHAR(255) NULL,
      display_name VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL,
      role_ids VARCHAR(500) NOT NULL,
      created_at VARCHAR(40) NULL,
      body LONGTEXT NOT NULL,
      KEY email (email)
    )`,
    `CREATE TABLE IF NOT EXISTS jobs (
      id VARCHAR(64) PRIMARY KEY,
      job_no VARCHAR(64) NOT NULL,
      job_order_no VARCHAR(64) NULL,
      customer_name VARCHAR(255) NOT NULL,
      status VARCHAR(40) NOT NULL,
      course VARCHAR(500) NOT NULL,
      training_date VARCHAR(20) NULL,
      body LONGTEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS attendees (
      id VARCHAR(64) PRIMARY KEY,
      job_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      company VARCHAR(255) NULL,
      eid VARCHAR(80) NULL,
      mobile VARCHAR(40) NULL,
      course VARCHAR(500) NULL,
      KEY job_id (job_id)
    )`,
    `CREATE TABLE IF NOT EXISTS certificates (
      id VARCHAR(64) PRIMARY KEY,
      job_id VARCHAR(64) NOT NULL,
      certificate_no VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      company VARCHAR(255) NULL,
      course VARCHAR(500) NULL,
      eid VARCHAR(80) NULL,
      training_date VARCHAR(20) NULL,
      expires_on VARCHAR(20) NULL,
      verification_ref VARCHAR(64) NULL,
      KEY job_id (job_id)
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      job_id VARCHAR(64) NOT NULL,
      message VARCHAR(500) NOT NULL,
      is_read TINYINT NOT NULL,
      created_at VARCHAR(40) NOT NULL,
      body LONGTEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sequences (
      name VARCHAR(64) PRIMARY KEY,
      value INT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS permission_grants (
      user_id VARCHAR(64) PRIMARY KEY,
      body LONGTEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS courses (
      name VARCHAR(255) PRIMARY KEY,
      description TEXT NULL
    )`,
  ];
  for (const sql of tables) await next.query(sql);
  const upgrades = [
    "ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER identifier",
    "ALTER TABLE users ADD COLUMN created_at VARCHAR(40) NULL AFTER role_ids",
    "ALTER TABLE users ADD KEY email (email)",
  ];
  for (const sql of upgrades) {
    await next.query(sql).catch((err: { code?: string }) => {
      if (err.code !== "ER_DUP_FIELDNAME" && err.code !== "ER_DUP_KEYNAME") throw err;
    });
  }
  pool = next;
  return pool;
}

function applyState(platform: Platform, data: SavedState): number {
  if (data.training) platform.training.loadSnapshot(data.training);
  if (data.users) platform.users.importSnapshot(data.users);
  platform.permissions.importUserPermissionGrants(data.userPermissions);
  for (const course of data.extraCourses ?? []) {
    platform.courses.addIfMissing(course.name, course.description);
  }
  return data.training?.jobs?.length ?? 0;
}

async function readDatabase(): Promise<SavedState | null> {
  const store = await database();
  const [savedRows] = await store.query<RowDataPacket[]>(
    "SELECT value FROM meta WHERE `key` = 'savedAt'"
  );
  if (!savedRows.length) return null;
  const [users] = await store.query<RowDataPacket[]>("SELECT body FROM users");
  const [jobs] = await store.query<RowDataPacket[]>("SELECT body FROM jobs");
  const [notifications] = await store.query<RowDataPacket[]>("SELECT body FROM notifications");
  const [sequences] = await store.query<RowDataPacket[]>("SELECT name, value FROM sequences");
  const [grants] = await store.query<RowDataPacket[]>("SELECT user_id, body FROM permission_grants");
  const [courses] = await store.query<RowDataPacket[]>("SELECT name, description FROM courses");
  const seq = Object.fromEntries(sequences.map((row) => [row.name, Number(row.value)]));
  const userPermissions: Record<string, string[]> = {};
  for (const row of grants) userPermissions[String(row.user_id)] = JSON.parse(String(row.body)) as string[];
  return {
    version: 1,
    savedAt: String(savedRows[0].value),
    users: users.map((row) => JSON.parse(String(row.body))),
    userPermissions: userPermissions as unknown as SavedState["userPermissions"],
    extraCourses: courses.map((row) => ({
      name: String(row.name),
      description: row.description == null ? undefined : String(row.description),
    })),
    training: {
      jobs: jobs.map((row) => JSON.parse(String(row.body))),
      notifications: notifications.map((row) => JSON.parse(String(row.body))),
      jobSeq: seq.jobSeq ?? 0,
      certSeq: seq.certSeq ?? 0,
      trainingOrderSeq: seq.trainingOrderSeq ?? 4500,
      serviceOrderSeq: seq.serviceOrderSeq ?? 120,
    },
  };
}

async function writeDatabase(payload: SavedState): Promise<void> {
  const store = await database();
  const training = payload.training;
  const conn = await store.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM users");
    await conn.query("DELETE FROM jobs");
    await conn.query("DELETE FROM attendees");
    await conn.query("DELETE FROM certificates");
    await conn.query("DELETE FROM notifications");
    await conn.query("DELETE FROM sequences");
    await conn.query("DELETE FROM permission_grants");
    await conn.query("DELETE FROM courses");
    await conn.query("DELETE FROM meta");
    for (const user of payload.users ?? []) {
      await conn.query(
        "INSERT INTO users (id, identifier, email, display_name, status, role_ids, created_at, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          user.id,
          user.identifier,
          user.email || null,
          user.displayName,
          user.status,
          (user.roleIds ?? []).join(", "),
          user.createdAt ? new Date(user.createdAt).toISOString() : null,
          JSON.stringify(user),
        ]
      );
    }
    for (const job of training?.jobs ?? []) {
      await conn.query(
        "INSERT INTO jobs (id, job_no, job_order_no, customer_name, status, course, training_date, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [job.id, job.jobNo, job.jobOrderNo || null, job.customerName, job.status, job.course, job.trainingDate || null, JSON.stringify(job)]
      );
      for (const person of job.attendees ?? []) {
        await conn.query(
          "INSERT INTO attendees (id, job_id, name, company, eid, mobile, course) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [person.id, job.id, person.name, person.company || null, person.idOrVisaNo || null, person.mobileNumber || null, person.course || null]
        );
      }
      for (const cert of job.certificates ?? []) {
        await conn.query(
          `INSERT INTO certificates
           (id, job_id, certificate_no, name, company, course, eid, training_date, expires_on, verification_ref)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [cert.id, job.id, cert.certificateNo, cert.name, cert.company || null, cert.course || null, cert.idOrVisaNo || null, cert.trainingDate || null, cert.expiresOn || null, cert.verificationRef || null]
        );
      }
    }
    for (const note of training?.notifications ?? []) {
      await conn.query(
        "INSERT INTO notifications (id, user_id, job_id, message, is_read, created_at, body) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [note.id, note.userId, note.jobId, note.message, note.read ? 1 : 0, new Date(note.createdAt).toISOString(), JSON.stringify(note)]
      );
    }
    await conn.query("INSERT INTO sequences (name, value) VALUES (?, ?), (?, ?), (?, ?), (?, ?)", [
      "jobSeq", training?.jobSeq ?? 0,
      "certSeq", training?.certSeq ?? 0,
      "trainingOrderSeq", training?.trainingOrderSeq ?? 4500,
      "serviceOrderSeq", training?.serviceOrderSeq ?? 120,
    ]);
    for (const [userId, keys] of Object.entries(payload.userPermissions ?? {})) {
      await conn.query("INSERT INTO permission_grants (user_id, body) VALUES (?, ?)", [userId, JSON.stringify(keys)]);
    }
    for (const course of payload.extraCourses ?? []) {
      await conn.query("INSERT INTO courses (name, description) VALUES (?, ?)", [course.name, course.description ?? null]);
    }
    await conn.query("INSERT INTO meta (`key`, value) VALUES ('savedAt', ?)", [payload.savedAt ?? new Date().toISOString()]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function readJsonFile(): Promise<SavedState | null> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    return JSON.parse(raw) as SavedState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.error("Could not read saved data:", err);
    return null;
  }
}

export async function loadPlatformState(platform: Platform): Promise<number> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const stored = await readDatabase();
    if (stored) return applyState(platform, stored);
  } catch (err) {
    console.error("Could not read MySQL; trying the saved file.", err);
  }
  const data = await readJsonFile();
  if (!data) return 0;
  const count = applyState(platform, data);
  try {
    await savePlatformState(platform);
  } catch (err) {
    console.error("Could not copy saved data into MySQL:", err);
  }
  return count;
}

export async function savePlatformState(platform: Platform): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const payload: SavedState = {
    version: 1,
    savedAt: new Date().toISOString(),
    training: platform.training.exportSnapshot(),
    users: platform.users.exportSnapshot(),
    userPermissions: platform.permissions.exportUserPermissionGrants(),
    extraCourses: platform.courses
      .list()
      .filter((c) => !SEED_COURSES.includes(c.name))
      .map((c) => ({ name: c.name, description: c.description })),
  };
  try {
    await writeDatabase(payload);
  } catch (err) {
    console.error("Could not save MySQL; the file copy was still written.", err);
  }
  await writeFile(DATA_FILE, JSON.stringify(payload), "utf8");
}
