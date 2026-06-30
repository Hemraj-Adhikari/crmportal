/**
 * ═══════════════════════════════════════════════════════
 * R2U CRM — Cloud Functions
 * sendBulkEmail: callable function used by bulk-communication.js
 * (the bulkEmail() / submitBulkEmail() flow in the CRM frontend)
 * ═══════════════════════════════════════════════════════
 *
 * Setup:
 *   1. cd functions
 *   2. npm install
 *   3. Set SMTP credentials (pick ONE option below)
 *
 *   Option A — Firebase Secrets (recommended, Gen 2):
 *     firebase functions:secrets:set SMTP_USER
 *     firebase functions:secrets:set SMTP_PASS
 *
 *   Option B — local .env file for emulator testing only:
 *     cp .env.example .env   (then fill in values — never commit .env)
 *
 *   4. firebase deploy --only functions:sendBulkEmail
 *
 * Gmail users: SMTP_USER is your Gmail address, SMTP_PASS must be a
 * 16-character "App Password" (Google Account → Security → App
 * Passwords). Normal Gmail passwords will NOT work.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();

const SMTP_HOST = defineSecret('SMTP_HOST'); // e.g. smtp.gmail.com
const SMTP_PORT = defineSecret('SMTP_PORT'); // e.g. 465
const SMTP_USER = defineSecret('SMTP_USER'); // sender email address
const SMTP_PASS = defineSecret('SMTP_PASS'); // app password / SMTP password
const SMTP_FROM_NAME = defineSecret('SMTP_FROM_NAME'); // optional, e.g. "Route2Uni"

// Roles allowed to trigger bulk email — keep in sync with VIEW_PERMISSIONS /
// checkAccess() role names used on the frontend.
const ALLOWED_ROLES = ['Super Admin', 'Admin', 'Document Officer', 'Application User'];

// Hard ceiling per call so one request can't be (ab)used to spam thousands
// of emails in one go — the frontend already sends one student at a time,
// this is just defence in depth.
const MAX_RECIPIENTS_PER_CALL = 1;

let cachedTransporter = null;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: SMTP_HOST.value(),
    port: Number(SMTP_PORT.value() || 465),
    secure: Number(SMTP_PORT.value() || 465) === 465, // true for 465, false for 587
    auth: {
      user: SMTP_USER.value(),
      pass: SMTP_PASS.value()
    }
  });
  return cachedTransporter;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function plainTextToHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

/**
 * Callable from the frontend as:
 *   const sendEmailFn = firebase.functions().httpsCallable('sendBulkEmail');
 *   await sendEmailFn({ to, subject, body, studentId });
 *
 * The frontend (submitBulkEmail() in bulk-communication.js) calls this once
 * per recipient and awaits each call sequentially with a small throttle, so
 * each invocation here only ever needs to handle a single recipient.
 */
exports.sendBulkEmail = onCall(
  {
    secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_NAME],
    region: 'us-central1' // change to match your project's region if different
  },
  async (request) => {
    // ---- Auth check ----
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to send email.');
    }

    // ---- Role check ----
    // Reads the staff record from Firestore using the caller's uid so the
    // role can't be spoofed by sending a fake role in the request body.
    const uid = request.auth.uid;
    const staffSnap = await admin.firestore().collection('staff').doc(uid).get();
    const staffRole = staffSnap.exists ? staffSnap.data().role : null;

    if (!staffRole || !ALLOWED_ROLES.includes(staffRole)) {
      throw new HttpsError(
        'permission-denied',
        'Tapaisanga bulk email garne permission chaina.'
      );
    }

    // ---- Input validation ----
    const { to, subject, body, studentId } = request.data || {};

    if (!to || typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new HttpsError('invalid-argument', 'A valid recipient email ("to") is required.');
    }
    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      throw new HttpsError('invalid-argument', 'Subject is required.');
    }
    if (!body || typeof body !== 'string' || !body.trim()) {
      throw new HttpsError('invalid-argument', 'Message body is required.');
    }
    if (subject.length > 200) {
      throw new HttpsError('invalid-argument', 'Subject is too long (max 200 characters).');
    }
    if (body.length > 20000) {
      throw new HttpsError('invalid-argument', 'Message body is too long (max 20,000 characters).');
    }

    // ---- Send ----
    const fromName = SMTP_FROM_NAME.value() || 'Route2Uni';
    const fromAddress = SMTP_USER.value();

    try {
      const transporter = getTransporter();
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromAddress}>`,
        to,
        subject,
        text: body,
        html: plainTextToHtml(body)
      });

      logger.info('[sendBulkEmail] sent', {
        to,
        studentId: studentId || null,
        sentBy: uid,
        messageId: info.messageId
      });

      // Optional: log to Firestore for an audit trail / "Sent this session"
      // history, mirroring the single-email sendNotification() flow.
      await admin.firestore().collection('emailLog').add({
        to,
        subject,
        studentId: studentId || null,
        sentBy: uid,
        sentByRole: staffRole,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        messageId: info.messageId
      });

      return { success: true, messageId: info.messageId };
    } catch (err) {
      logger.error('[sendBulkEmail] failed', { to, studentId: studentId || null, error: err.message });
      throw new HttpsError('internal', 'Failed to send email: ' + err.message);
    }
  }
);
