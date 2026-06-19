// backend/app.js
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import "./cron.js";
import { initSubscriptionSync } from "./cron/syncSubscription.js";
import { errorMiddleware } from "./middleware/errorMiddleware.js";
import adminRoutes from "./routes/analytics.js";
import anchorCardRoutes from "./routes/anchorCardRoutes.js";
import anchorCustomerRoutes from "./routes/anchorCustomerRoutes.js";
import anchorVirtualAccountRoutes from "./routes/anchorVirtualAccount.js";
import anchorWalletRoutes from "./routes/anchorWalletRoutes.js";
import authRoutes from "./routes/auth.js";
import { default as bankRoutes } from "./routes/banks.js";
import budgetRoutes from "./routes/budget.js";
import cardRoutes from "./routes/cardRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import insightRoutes from "./routes/insight.js";
import monoRoutes from "./routes/monoWebhook.js";
import notificationRoutes from "./routes/notifications.js";
import savingsRoutes from "./routes/savings.js";
import subscriptionRoutes from "./routes/subscription.js";
import transactionRoutes from "./routes/transactions.js";
import userRoutes from "./routes/users.js";
import webhookRoutes from "./routes/webhookRoutes.js";

// =============== LOAD ENVIRONMENT VARIABLES FIRST ===============
// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load .env.local from project root
const envPath = path.resolve(process.cwd(), ".env.local");
const result = dotenv.config({ path: envPath });

if (result.error) {
	console.error(`❌ Failed to load .env.local from ${envPath}`);
	console.error(`   Error: ${result.error.message}`);
	console.log(`   Looking for .env.local in: ${process.cwd()}`);
	process.exit(1);
}

console.log(`✅ Loaded environment from: ${envPath}`);
console.log(`📝 MONGO_URI: ${process.env.MONGO_URI ? "✓ Set" : "✗ Missing"}`);
console.log(`🔑 JWT_SECRET: ${process.env.JWT_SECRET ? "✓ Set" : "✗ Missing"}`);
console.log(
	`🏦 ANCHOR_API_KEY: ${process.env.ANCHOR_API_KEY ? "✓ Set" : "✗ Missing"}\n`,
);

// Verify required environment variables
const requiredEnvVars = ["MONGO_URI", "JWT_SECRET"];
const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
	console.error(
		`❌ Missing required environment variables: ${missingVars.join(", ")}`,
	);
	console.error(`   Please check your .env.local file`);
	process.exit(1);
}

const app = express();

// =============== SIMPLE CORS (WORKS) ===============
// Allow all origins - for development
app.use((req, res, next) => {
	// Allow all origins
	res.header("Access-Control-Allow-Origin", "*");
	res.header(
		"Access-Control-Allow-Methods",
		"GET, POST, PUT, DELETE, PATCH, OPTIONS",
	);
	res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

	// Handle preflight
	if (req.method === "OPTIONS") {
		return res.sendStatus(200);
	}

	next();
});

// ✅ HEALTH CHECK - Must respond immediately, no DB required
app.get("/api/health", (req, res) => {
	res.status(200).json({
		status: "ok",
		timestamp: new Date().toISOString(),
		environment: process.env.NODE_ENV || "development",
		mongodb:
			mongoose.connection.readyState === 1 ? "connected" : "disconnected",
	});
});

app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/wallet", anchorWalletRoutes);
app.use("/api/savings", savingsRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/users", userRoutes);
app.use("/api/budgets", budgetRoutes);
app.use("/api/insights", insightRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/account", bankRoutes);
app.use("/api/mono", monoRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/anchor/customers", anchorCustomerRoutes);
app.use("/api/cards", cardRoutes);
app.use("/api/anchor/wallets", anchorWalletRoutes);
app.use("/api/anchor/cards", anchorCardRoutes);
app.use("/api/anchor/accounts", anchorVirtualAccountRoutes);

// Error handler
app.use(errorMiddleware);

// DB Connection with better error handling (Mongoose 7+ compatible)
const connectDB = async () => {
	try {
		const mongoURI = process.env.MONGO_URI;

		if (!mongoURI) {
			throw new Error("MONGO_URI is not defined in environment variables");
		}

		console.log("📦 Connecting to MongoDB...");
		// Mask credentials in log
		const maskedURI = mongoURI.replace(/\/\/([^:]+):([^@]+)@/, "//***:***@");
		console.log(`📍 Connection string: ${maskedURI.substring(0, 50)}...`);

		// REMOVED deprecated options for Mongoose 7+
		await mongoose.connect(mongoURI);

		console.log("✅ MongoDB connected successfully");
		console.log(`📚 Database: ${mongoose.connection.name}`);
		console.log(`🖥️  Host: ${mongoose.connection.host}\n`);

		// Start subscription sync in background
		initSubscriptionSync().catch((err) => {
			console.error("Subscription sync failed to start:", err);
		});
	} catch (err) {
		console.error("\n❌ MongoDB Connection Error:", err.message);
		console.error("\n💡 Troubleshooting tips:");
		console.error(
			"1. Check your MongoDB Atlas network whitelist (0.0.0.0/0 for development)",
		);
		console.error("2. Verify username/password in MONGO_URI");
		console.error("3. Make sure the database user has proper permissions");
		console.error("4. Check if you're connected to the internet\n");

		// Don't exit - let the app run but with DB error
		console.error("⚠️  Continuing without database connection...");
	}
};

// Call connectDB
connectDB();

// Handle mongoose connection events
mongoose.connection.on("error", (err) => {
	console.error("MongoDB connection error:", err);
});

mongoose.connection.on("disconnected", () => {
	console.warn("⚠️ MongoDB disconnected");
});

mongoose.connection.on("connected", () => {
	console.log("✅ MongoDB connected");
});

process.on("SIGINT", async () => {
	await mongoose.connection.close();
	console.log("MongoDB connection closed due to app termination");
	process.exit(0);
});

export default app;
