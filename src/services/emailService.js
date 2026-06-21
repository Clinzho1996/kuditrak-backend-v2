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

// ================= BASE EMAIL FUNCTION =================
export const sendEmail = async ({ to, subject, html }) => {
	try {
		const resend = getResendInstance();

		console.log("📧 Attempting to send email:", { to, subject });

		const response = await resend.emails.send({
			from: process.env.EMAIL_FROM || "noreply@kuditrak.com",
			to: to,
			subject: subject,
			html: html,
		});

		console.log("✅ Resend response:", response);
		return response;
	} catch (error) {
		console.error("❌ Error sending email with Resend:", error);
		throw error;
	}
};

// ================= OTP EMAIL =================
export const sendOtpEmail = async (email, code) => {
	return sendEmail({
		to: email,
		subject: "Your Kuditrak OTP Code",
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<style>
					body { font-family: Arial, sans-serif; background: #f4f6f8; padding: 20px; }
					.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
					.header { text-align: center; margin-bottom: 30px; }
					.header h1 { color: #1C352D; font-size: 24px; }
					.code { font-size: 48px; font-weight: bold; color: #10B981; text-align: center; padding: 20px; background: #F4F6F8; border-radius: 12px; margin: 20px 0; letter-spacing: 8px; }
					.footer { text-align: center; color: #98A2B3; font-size: 12px; margin-top: 30px; border-top: 1px solid #F2F4F7; padding-top: 20px; }
				</style>
			</head>
			<body>
				<div class="container">
					<div class="header">
						<h1>🔐 Verification Code</h1>
					</div>
					<p style="font-size: 16px; color: #101828;">
						Enter the code below to verify your account:
					</p>
					<div class="code">${code}</div>
					<p style="color: #6C7278; font-size: 14px;">
						This code expires in <strong>10 minutes</strong>.
					</p>
					<div class="footer">
						<p>Kuditrak — Secure financial management</p>
					</div>
				</div>
			</body>
			</html>
		`,
	});
};

// ================= MONEY REQUEST EMAIL =================
export const sendRequestNotificationEmail = async ({
	recipientEmail,
	recipientName,
	senderName,
	amount,
	note,
	requestId,
	reference,
}) => {
	const appUrl = process.env.APP_URL || "https://kuditrak.com";

	const html = `
		<!DOCTYPE html>
		<html>
		<head>
			<style>
				body { font-family: Arial, sans-serif; background: #f4f6f8; padding: 20px; }
				.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
				.header { text-align: center; margin-bottom: 30px; }
				.header h1 { color: #1C352D; font-size: 24px; }
				.header .logo { font-size: 32px; }
				.amount { font-size: 36px; font-weight: bold; color: #10B981; text-align: center; padding: 20px; background: #F4F6F8; border-radius: 12px; margin: 20px 0; }
				.details { margin: 20px 0; }
				.detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #F2F4F7; }
				.detail-label { color: #6C7278; }
				.detail-value { color: #101828; font-weight: 600; }
				.button { display: inline-block; background: #1C352D; color: white; padding: 14px 28px; border-radius: 9999px; text-decoration: none; text-align: center; margin: 20px 0; }
				.button-container { text-align: center; }
				.footer { text-align: center; color: #98A2B3; font-size: 12px; margin-top: 30px; border-top: 1px solid #F2F4F7; padding-top: 20px; }
				.note-box { background: #E6F4EA; padding: 12px 16px; border-radius: 8px; margin: 10px 0; color: #2D5433; }
				.status-pending { background: #FFF1E6; padding: 4px 12px; border-radius: 9999px; color: #F97316; font-size: 12px; font-weight: 600; display: inline-block; }
				.actions { display: flex; gap: 12px; justify-content: center; margin: 20px 0; }
				.btn-approve { background: #10B981; color: white; padding: 10px 24px; border-radius: 9999px; text-decoration: none; }
				.btn-decline { background: #EF4444; color: white; padding: 10px 24px; border-radius: 9999px; text-decoration: none; }
				.btn-secondary { background: #F4F6F8; color: #101828; padding: 10px 24px; border-radius: 9999px; text-decoration: none; }
			</style>
		</head>
		<body>
			<div class="container">
				<div class="header">
					<div class="logo"></div>
					<h1>Money Request</h1>
					<span class="status-pending">Pending</span>
				</div>

				<p style="font-size: 16px; color: #101828;">
					Hey <strong>${recipientName}</strong> 👋
				</p>

				<p style="font-size: 16px; color: #101828;">
					<strong>${senderName}</strong> has requested money from you:
				</p>

				<div class="amount">
					₦${amount.toLocaleString()}
				</div>

				${
					note
						? `
					<div class="note-box">
						<strong>Note:</strong> ${note}
					</div>
				`
						: ""
				}

				<div class="details">
					<div class="detail-row">
						<span class="detail-label">From</span>
						<span class="detail-value">${senderName}</span>
					</div>
					<div class="detail-row">
						<span class="detail-label">Reference</span>
						<span class="detail-value">${reference}</span>
					</div>
					<div class="detail-row" style="border-bottom: none;">
						<span class="detail-label">Date</span>
						<span class="detail-value">${new Date().toLocaleString()}</span>
					</div>
				</div>

				<div class="button-container">
					<a href="${appUrl}/requests/${requestId}" class="button">
						View Request
					</a>
				</div>

				<div class="footer">
					<p>You're receiving this because someone requested money from you on Kuditrak.</p>
					<p style="margin-top: 8px; font-size: 11px; color: #98A2B3;">
						Request ID: ${requestId} · Reference: ${reference}
					</p>
					<p style="margin-top: 16px; color: #6C7278; font-size: 13px;">
						Kuditrak — Secure financial management
					</p>
				</div>
			</div>
		</body>
		</html>
	`;

	return sendEmail({
		to: recipientEmail,
		subject: `Money Request from ${senderName} - ₦${amount.toLocaleString()}`,
		html,
	});
};

// ================= REQUEST APPROVED EMAIL =================
export const sendRequestApprovedEmail = async ({
	requesterEmail,
	requesterName,
	approverName,
	amount,
	requestId,
	reference,
}) => {
	const appUrl = process.env.APP_URL || "https://kuditrak.com";

	const html = `
		<!DOCTYPE html>
		<html>
		<head>
			<style>
				body { font-family: Arial, sans-serif; background: #f4f6f8; padding: 20px; }
				.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
				.header { text-align: center; margin-bottom: 30px; }
				.header h1 { color: #1C352D; font-size: 24px; }
				.amount { font-size: 36px; font-weight: bold; color: #10B981; text-align: center; padding: 20px; background: #F4F6F8; border-radius: 12px; margin: 20px 0; }
				.check { font-size: 48px; color: #10B981; text-align: center; }
				.footer { text-align: center; color: #98A2B3; font-size: 12px; margin-top: 30px; border-top: 1px solid #F2F4F7; padding-top: 20px; }
			</style>
		</head>
		<body>
			<div class="container">
				<div class="header">
					<div class="check">✅</div>
					<h1>Request Approved!</h1>
				</div>

				<p style="font-size: 16px; color: #101828;">
					Hey <strong>${requesterName}</strong> 🎉
				</p>

				<p style="font-size: 16px; color: #101828;">
					<strong>${approverName}</strong> has approved your request!
				</p>

				<div class="amount">
					₦${amount.toLocaleString()}
				</div>

				<div class="details">
					<div class="detail-row">
						<span class="detail-label">From</span>
						<span class="detail-value">${approverName}</span>
					</div>
					<div class="detail-row" style="border-bottom: none;">
						<span class="detail-label">Reference</span>
						<span class="detail-value">${reference}</span>
					</div>
				</div>

				<div class="button-container">
					<a href="${appUrl}/transactions" class="button">
						View Transaction
					</a>
				</div>

				<div class="footer">
					<p>Kuditrak — Secure financial management</p>
				</div>
			</div>
		</body>
		</html>
	`;

	return sendEmail({
		to: requesterEmail,
		subject: `Request Approved - ₦${amount.toLocaleString()}`,
		html,
	});
};

// ================= REQUEST DECLINED EMAIL =================
export const sendRequestDeclinedEmail = async ({
	requesterEmail,
	requesterName,
	declinerName,
	amount,
	requestId,
}) => {
	const html = `
		<!DOCTYPE html>
		<html>
		<head>
			<style>
				body { font-family: Arial, sans-serif; background: #f4f6f8; padding: 20px; }
				.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
				.header { text-align: center; margin-bottom: 30px; }
				.header h1 { color: #1C352D; font-size: 24px; }
				.amount { font-size: 24px; font-weight: bold; color: #EF4444; text-align: center; padding: 20px; background: #FEF3F2; border-radius: 12px; margin: 20px 0; }
				.footer { text-align: center; color: #98A2B3; font-size: 12px; margin-top: 30px; border-top: 1px solid #F2F4F7; padding-top: 20px; }
			</style>
		</head>
		<body>
			<div class="container">
				<div class="header">
					<h1>Request Declined</h1>
				</div>

				<p style="font-size: 16px; color: #101828;">
					Hey <strong>${requesterName}</strong>
				</p>

				<p style="font-size: 16px; color: #101828;">
					<strong>${declinerName}</strong> has declined your request for:
				</p>

				<div class="amount">
					₦${amount.toLocaleString()}
				</div>

				<p style="color: #6C7278; font-size: 14px; text-align: center;">
					Don't worry! You can send a new request or try a different amount.
				</p>

				<div class="button-container">
					<a href="${process.env.APP_URL}/send-money" class="button">
						Send New Request
					</a>
				</div>

				<div class="footer">
					<p>Kuditrak — Secure financial management</p>
				</div>
			</div>
		</body>
		</html>
	`;

	return sendEmail({
		to: requesterEmail,
		subject: `❌ Request Declined - ₦${amount.toLocaleString()}`,
		html,
	});
};

// ================= WELCOME EMAIL =================
export const sendWelcomeEmail = async (email, name) => {
	const html = `
		<!DOCTYPE html>
		<html>
		<head>
			<style>
				body { font-family: Arial, sans-serif; background: #f4f6f8; padding: 20px; }
				.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
				.header { text-align: center; margin-bottom: 30px; }
				.header h1 { color: #1C352D; font-size: 24px; }
				.footer { text-align: center; color: #98A2B3; font-size: 12px; margin-top: 30px; border-top: 1px solid #F2F4F7; padding-top: 20px; }
			</style>
		</head>
		<body>
			<div class="container">
				<div class="header">
					<h1>🎉 Welcome to Kuditrak!</h1>
				</div>

				<p style="font-size: 16px; color: #101828;">
					Hey <strong>${name}</strong> 👋
				</p>

				<p style="font-size: 16px; color: #101828;">
					Welcome to Kuditrak! We're excited to help you manage your finances better.
				</p>

				<p style="font-size: 16px; color: #101828;">
					Here's what you can do:
				</p>

				<ul style="color: #101828; font-size: 15px; line-height: 1.8;">
					<li>Send and request money</li>
					<li>Track your spending</li>
					<li>Set savings goals</li>
					<li>Create virtual cards</li>
				</ul>

				<div class="button-container">
					<a href="${process.env.APP_URL}/dashboard" class="button">
						🚀 Get Started
					</a>
				</div>

				<div class="footer">
					<p>Kuditrak — Secure financial management</p>
				</div>
			</div>
		</body>
		</html>
	`;

	return sendEmail({
		to: email,
		subject: "🎉 Welcome to Kuditrak!",
		html,
	});
};

// ================= EXPORTS =================
export default {
	sendEmail,
	sendOtpEmail,
	sendRequestNotificationEmail,
	sendRequestApprovedEmail,
	sendRequestDeclinedEmail,
	sendWelcomeEmail,
};
