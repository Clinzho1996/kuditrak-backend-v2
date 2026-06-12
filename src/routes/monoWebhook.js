// routes/monoWebhook.js
import express from "express";
import BankConnection from "../models/BankConnection.js";
import User from "../models/User.js";
import mono from "../services/monoService.js";

const router = express.Router();

// Helper function to get bank code from bank name
const getBankCode = (bankName) => {
	if (!bankName) return null;

	const bankCodes = {
		GTBank: "058",
		"Guaranty Trust Bank": "058",
		"Access Bank": "044",
		"Access Bank Plc": "044",
		"Wema Bank": "035",
		"Wema Bank Plc": "035",
		UBA: "033",
		"United Bank For Africa": "033",
		"First Bank": "011",
		"First Bank of Nigeria": "011",
		"Zenith Bank": "057",
		"Zenith Bank Plc": "057",
		FCMB: "214",
		"First City Monument Bank": "214",
		"Stanbic IBTC": "039",
		"Stanbic IBTC Bank": "039",
		"Polaris Bank": "076",
		"Polaris Bank Limited": "076",
		"Union Bank of Nigeria": "032",
		"Union Bank": "032",
		"Fidelity Bank": "070",
		"Fidelity Bank Plc": "070",
		"Sterling Bank": "232",
		"Sterling Bank Plc": "232",
		Ecobank: "050",
		"Ecobank Nigeria": "050",
	};

	// Try exact match first
	if (bankCodes[bankName]) return bankCodes[bankName];

	// Try partial match
	for (const [key, code] of Object.entries(bankCodes)) {
		if (
			bankName.toLowerCase().includes(key.toLowerCase()) ||
			key.toLowerCase().includes(bankName.toLowerCase())
		) {
			return code;
		}
	}

	return null;
};

router.post("/webhook", async (req, res) => {
	try {
		const webhookPayload = req.body;
		const eventType = webhookPayload?.event;
		const payload = webhookPayload?.data;

		console.log("📌 Event Type:", eventType);

		// Respond immediately to acknowledge receipt
		res.status(200).json({ success: true });

		if (!eventType || !payload) {
			console.log("⚠️ Invalid payload or missing event type");
			return;
		}

		// ---------- ACCOUNT CONNECTED ----------
		// This event only has basic info - just create a placeholder
		if (eventType === "mono.events.account_connected") {
			const accountId = payload.id;
			const customerId = payload.customer;

			console.log("🔄 Processing account_connected for account:", accountId);

			const user = await User.findOne({ monoCustomerId: customerId });
			if (!user) {
				console.log("❌ User not found for monoCustomerId:", customerId);
				return;
			}

			// Check if this account already exists
			let connection = await BankConnection.findOne({
				monoAccountId: accountId,
			});

			if (connection) {
				console.log("⚠️ Account already exists, updating status:", accountId);
				connection.status = "Processing";
				connection.lastSync = new Date();
				await connection.save();
			} else {
				// Create a PLACEHOLDER connection with minimal info
				// The required fields will be filled in account_updated event
				connection = await BankConnection.create({
					userId: user._id,
					monoCustomerId: customerId,
					monoAccountId: accountId,
					accountName: "Pending...", // Placeholder
					accountNumber: "Pending...", // Placeholder
					bankName: "Pending...", // Placeholder
					status: "Processing",
					lastSync: new Date(),
					provider: "mono",
				});
				console.log(
					"✅ Placeholder connection created for account:",
					accountId,
				);
			}

			console.log("   User ID:", user._id);
			console.log("   User Email:", user.email);
			return;
		}

		// ---------- ACCOUNT UPDATED ----------
		// This event has full account details - update the placeholder
		if (eventType === "mono.events.account_updated") {
			console.log("🔄 Processing account_updated event");

			const accountData = payload.account || payload;
			if (!accountData || !accountData._id) {
				console.log("⚠️ No account data in payload");
				return;
			}

			const accountId = accountData._id;

			// Extract data from the webhook payload
			const accountName = accountData.name;
			const accountNumber = accountData.accountNumber;
			const bankName = accountData.institution?.name;
			const bankCodeFromMono = accountData.institution?.bankCode;
			const balance = accountData.balance;
			const currency = accountData.currency;
			const bvn = accountData.bvn;

			console.log(`📋 Account Details from webhook:`);
			console.log(`   Account Name: ${accountName}`);
			console.log(`   Account Number: ${accountNumber}`);
			console.log(`   Bank Name: ${bankName}`);
			console.log(`   Bank Code from Mono: ${bankCodeFromMono}`);
			console.log(`   Balance: ${balance}`);

			// Find the existing connection by monoAccountId
			let connection = await BankConnection.findOne({
				monoAccountId: accountId,
			});

			if (!connection) {
				console.log("❌ No connection found for account:", accountId);
				console.log("   Trying to find by customer ID...");

				// Try to find by customer
				const customerId = accountData.customer || payload.customer;
				if (customerId) {
					const user = await User.findOne({ monoCustomerId: customerId });
					if (user) {
						// Create new connection
						const bankCode =
							bankCodeFromMono && bankCodeFromMono !== "000000"
								? bankCodeFromMono
								: getBankCode(bankName);

						connection = await BankConnection.create({
							userId: user._id,
							monoCustomerId: customerId,
							monoAccountId: accountId,
							accountName: accountName || "Unknown",
							accountNumber: accountNumber || "Unknown",
							bankName: bankName || "Unknown",
							bankCode: bankCode,
							balance: balance || 0,
							currency: currency || "NGN",
							bvn: bvn,
							status: "Active",
							lastSync: new Date(),
							provider: "mono",
						});
						console.log("✅ New connection created from account_updated");
					}
				}

				if (!connection) {
					console.log("❌ Still no connection found, cannot proceed");
					return;
				}
			}

			// Get bank code (use Mono's bankCode if valid, otherwise map from bank name)
			let bankCode = bankCodeFromMono;
			if (!bankCode || bankCode === "000000") {
				bankCode = getBankCode(bankName);
				console.log(`   Mapped Bank Code: ${bankCode}`);
			}

			// Update the connection with full details
			connection.accountName = accountName;
			connection.accountNumber = accountNumber;
			connection.bankName = bankName;
			connection.bankCode = bankCode;
			connection.balance = balance || 0;
			connection.currency = currency || "NGN";
			connection.bvn = bvn;
			connection.status = "Active";
			connection.lastSync = new Date();

			await connection.save();

			console.log("✅ Account updated successfully:");
			console.log("   Account ID:", accountId);
			console.log("   Account Name:", connection.accountName);
			console.log("   Account Number:", connection.accountNumber);
			console.log("   Bank:", connection.bankName);
			console.log("   Bank Code:", connection.bankCode);
			console.log("   Balance:", connection.balance);
			console.log("   Status:", connection.status);
			return;
		}

		// ---------- ACCOUNT REAUTHORIZED ----------
		if (eventType === "mono.events.account_reauthorized") {
			console.log("🔄 Processing reauthorization event");

			const accountData = payload.account || payload;
			if (!accountData || !accountData._id) {
				console.log("⚠️ No account data in payload");
				return;
			}

			const accountId = accountData._id;

			try {
				let connection = await BankConnection.findOne({
					monoAccountId: accountId,
				});

				if (!connection) {
					console.log(
						"⚠️ Connection not found for reauthorization:",
						accountId,
					);

					// Fetch full account details from Mono API
					const monoResponse = await mono.get(`/accounts/${accountId}`);
					const fullAccount = monoResponse.data.data;
					const customerId = fullAccount.customer?.id;

					if (customerId) {
						const user = await User.findOne({ monoCustomerId: customerId });

						if (user) {
							const bankCode = getBankCode(fullAccount.institution?.name);

							connection = await BankConnection.create({
								userId: user._id,
								monoCustomerId: customerId,
								monoAccountId: accountId,
								accountName: fullAccount.name,
								accountNumber: fullAccount.account_number,
								bankName: fullAccount.institution?.name,
								bankCode: bankCode,
								balance: fullAccount.balance,
								currency: fullAccount.currency,
								bvn: fullAccount.bvn,
								status: "Active",
								lastSync: new Date(),
								provider: "mono",
							});
							console.log(
								"✅ Recovered connection during reauthorization:",
								accountId,
							);
						}
					}
				} else {
					// Update existing connection
					connection.status = "Active";
					connection.lastSync = new Date();
					await connection.save();
					console.log("✅ Account reauthorized and updated:", accountId);
				}
			} catch (error) {
				console.error("❌ Error processing reauthorization:", error);
			}
			return;
		}

		console.log("⚠️ Unknown event type:", eventType);
	} catch (err) {
		console.error("❌ Webhook error:", err);
	}
});

export default router;
