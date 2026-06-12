// src/utils/emailService.js
import { Resend } from "resend";

let resendInstance = null;

const getResendInstance = () => {
	if (!resendInstance) {
		if (!process.env.RESEND_API_KEY) {
			throw new Error("Missing RESEND_API_KEY environment variable");
		}
		resendInstance = new Resend(process.env.RESEND_API_KEY);
	}
	return resendInstance;
};

// Update to accept an object with email and code
export const sendEmail = async ({ to, subject, html }) => {
	try {
		const resend = getResendInstance();

		console.log("Attempting to send email:", { to, subject });

		const response = await resend.emails.send({
			from: process.env.EMAIL_FROM || "noreply@kuditrak.com", // Make sure this is set
			to: to,
			subject: subject,
			html: html,
		});

		console.log("Resend response:", response);
		return response;
	} catch (error) {
		console.error("Error sending email with Resend:", error);
		throw error; // Re-throw to handle in the controller
	}
};

// Keep the old function for backward compatibility if needed
export const sendOtpEmail = async (email, code) => {
	return sendEmail({
		to: email,
		subject: "Your Kuditrak OTP Code",
		html: `
      <h2>Kuditrak Verification</h2>
      <p>Your OTP code is:</p>
      <h1>${code}</h1>
      <p>This code expires in 10 minutes.</p>
    `,
	});
};
