import nodemailer from "nodemailer";
import type { SendOtp } from "./registration.js";

/**
 * Sends OTP emails through Gmail (or any SMTP server). Gmail needs an App
 * Password, not the normal account password. Without SMTP settings the code is
 * printed to the server console so registration can be tested locally.
 */
export function createOtpMailer(): SendOtp {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    return async (email, code) => {
      console.log(`[register] SMTP_USER/SMTP_PASS not set. OTP for ${email}: ${code}`);
    };
  }
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  const from = process.env.SMTP_FROM || `Westcal Platform <${user}>`;
  return async (email, code, displayName) => {
    await transport.sendMail({
      from,
      to: email,
      subject: `Your Westcal verification code: ${code}`,
      text: `Hello ${displayName},\n\nYour Westcal Platform verification code is ${code}.\nIt expires in 10 minutes.\n\nIf you did not ask to register, ignore this email.`,
      html: `<p>Hello ${escapeHtml(displayName)},</p><p>Your Westcal Platform verification code is</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 10 minutes.</p><p style="color:#6b7280">If you did not ask to register, ignore this email.</p>`,
    });
  };
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export function parseAllowList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
