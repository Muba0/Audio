import express from "express";
import bodyParser from "body-parser";
import multer from "multer";
import Razorpay from "razorpay";
import dotenv from "dotenv";
import cors from "cors";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// Setup paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// App setup
const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Initialize SQLite database
const db = new Database("applications.db");

db.prepare(`
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    gender TEXT,
    dob TEXT,
    bio TEXT,
    resume_path TEXT,
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    payment_status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// File Upload Config (Multer)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [".pdf", ".doc", ".docx"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedTypes.includes(ext)) {
      return cb(new Error("Only PDF/DOC/DOCX files are allowed"));
    }
    cb(null, true);
  },
});

// Razorpay Setup
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create Application + Generate Order
app.post("/api/submit", upload.single("resume"), async (req, res) => {
  try {
    const { full_name, email, phone, gender, dob, bio } = req.body;
    const resumeFile = req.file;

    if (!resumeFile) {
      return res.status(400).json({ error: "Resume upload required" });
    }

    // Create Razorpay order
    const amount = process.env.SUBMISSION_FEE_RUPEES * 100; // in paise
    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      payment_capture: 1,
    });

    // Save as pending submission
    db.prepare(`
      INSERT INTO applications 
      (full_name, email, phone, gender, dob, bio, resume_path, razorpay_order_id, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      full_name,
      email,
      phone,
      gender,
      dob,
      bio,
      resumeFile.filename,
      order.id,
      "PENDING"
    );

    res.json({
      orderId: order.id,
      key: process.env.RAZORPAY_KEY_ID,
      amount,
    });
  } catch (err) {
    console.error("Error submitting form:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Payment verification endpoint
app.post("/api/verify-payment", (req, res) => {
  const { order_id, payment_id, status } = req.body;

  try {
    db.prepare(`
      UPDATE applications
      SET razorpay_payment_id = ?, payment_status = ?
      WHERE razorpay_order_id = ?
    `).run(payment_id, status, order_id);

    res.json({ success: true });
  } catch (err) {
    console.error("Payment verification error:", err);
    res.status(500).json({ error: "DB update failed" });
  }
});

// Admin view - list all applications
app.get("/api/applications", (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM applications ORDER BY created_at DESC").all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch applications" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
