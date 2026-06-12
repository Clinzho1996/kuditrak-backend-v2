import axios from "axios";
import dotenv from "dotenv";
import Transaction from "../models/Transaction.js";

dotenv.config();

// Validate environment variables
if (!process.env.MONO_SECRET_KEY) {
	console.error("❌ MONO_SECRET_KEY is not set in environment variables");
}

if (!process.env.MONO_BASE_URL) {
	console.error("❌ MONO_BASE_URL is not set in environment variables");
}

// Create axios instance with correct configuration
const mono = axios.create({
	baseURL: process.env.MONO_BASE_URL || "https://api.withmono.com/v2",
	headers: {
		"mono-sec-key": process.env.MONO_SECRET_KEY,
		"Content-Type": "application/json",
	},
	timeout: 30000, // 30 seconds timeout
});

// Add request interceptor for logging
mono.interceptors.request.use(
	(config) => {
		console.log(
			`🌐 Mono API Request: ${config.method.toUpperCase()} ${config.url}`,
		);
		if (config.params) {
			console.log(`   Params:`, config.params);
		}
		return config;
	},
	(error) => {
		console.error("❌ Mono Request Error:", error);
		return Promise.reject(error);
	},
);

// Add response interceptor for logging
mono.interceptors.response.use(
	(response) => {
		console.log(
			`✅ Mono API Response: ${response.status} ${response.config.url}`,
		);
		if (response.data && response.data.meta) {
			console.log(
				`   Total: ${response.data.meta.total || 0}, Page: ${response.data.meta.page || 1}`,
			);
		}
		return response;
	},
	(error) => {
		if (error.response) {
			console.error(
				`❌ Mono API Error: ${error.response.status} - ${error.response.statusText}`,
			);
			console.error(`   URL: ${error.config?.url}`);
			console.error(`   Response:`, error.response.data);
		} else if (error.request) {
			console.error("❌ Mono API No Response:", error.request);
		} else {
			console.error("❌ Mono API Error:", error.message);
		}
		return Promise.reject(error);
	},
);

console.log("✅ Mono service initialized with:");
console.log(
	`   Base URL: ${process.env.MONO_BASE_URL || "https://api.withmono.com/v2"}`,
);
console.log(
	`   Secret Key: ${process.env.MONO_SECRET_KEY ? "✓ Present" : "✗ Missing"}`,
);

export default mono;

// Fixed pullTransactionsFromMono function
export const pullTransactionsFromMono = async (conn, since = null) => {
	try {
		console.log(
			`🔵 Pulling transactions from Mono for account: ${conn.monoAccountId}`,
		);

		// Build URL with proper parameters
		let url = `/accounts/${conn.monoAccountId}/transactions`;
		const params = {
			perPage: 100,
		};

		if (since) {
			params.start = since.toISOString();
			console.log(`   Since: ${params.start}`);
		}

		let allTransactions = [];
		let page = 1;
		let hasMore = true;

		while (hasMore) {
			console.log(`   Fetching page ${page}...`);

			const response = await mono.get(url, {
				params: {
					...params,
					page: page,
				},
			});

			const transactions = response.data.data || [];
			const meta = response.data.meta || {};

			console.log(
				`   Found ${transactions.length} transactions on page ${page}`,
			);

			if (transactions.length === 0) {
				break;
			}

			allTransactions = [...allTransactions, ...transactions];

			// Check if there are more pages
			hasMore = !!meta.next && transactions.length === params.perPage;
			page++;
		}

		console.log(`📊 Total transactions fetched: ${allTransactions.length}`);

		let savedCount = 0;
		let updatedCount = 0;

		// Save transactions to database
		for (const tx of allTransactions) {
			// Determine transaction type
			// Mono uses 'debit' and 'credit' types
			let type = "expense";
			if (tx.type === "credit" || tx.type === "income" || tx.amount > 0) {
				type = "income";
			} else if (tx.type === "debit" || tx.amount < 0) {
				type = "expense";
			}

			const transactionData = {
				userId: conn.userId,
				bankConnectionId: conn._id,
				transactionId: tx.id || tx._id,
				amount: Math.abs(tx.amount),
				type: type,
				description: tx.narration || tx.description || "Mono Transaction",
				categoryId: null,
				categoryName: tx.category || null,
				source: "bank",
				date: tx.date ? new Date(tx.date) : new Date(),
				status: "Completed",
				currency: tx.currency || "NGN",
				balance: tx.balance,
				metadata: {
					monoId: tx.id || tx._id,
					originalType: tx.type,
					narration: tx.narration,
				},
			};

			// Use updateOne with upsert to avoid duplicates
			const result = await Transaction.updateOne(
				{
					transactionId: tx.id || tx._id,
					userId: conn.userId,
				},
				{ $set: transactionData },
				{ upsert: true },
			);

			if (result.upsertedCount > 0) {
				savedCount++;
			} else if (result.modifiedCount > 0) {
				updatedCount++;
			}
		}

		console.log(`📈 Pull Summary: ${savedCount} new, ${updatedCount} updated`);

		return {
			success: true,
			total: allTransactions.length,
			saved: savedCount,
			updated: updatedCount,
			transactions: allTransactions,
		};
	} catch (error) {
		console.error("❌ Error pulling transactions from Mono:");
		console.error(`   Message: ${error.message}`);
		if (error.response) {
			console.error(`   Status: ${error.response.status}`);
			console.error(`   Data:`, error.response.data);
		}
		throw error;
	}
};
