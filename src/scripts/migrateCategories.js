// backend/scripts/migrateCategories.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import Category from "../models/Category.js";
import User from "../models/User.js";

dotenv.config();

// Default categories to be created for every user
const DEFAULT_CATEGORIES = [
	// Income categories
	{
		name: "Salary",
		type: "income",
		keywords: ["salary", "payroll", "wages", "bonus"],
	},
	{
		name: "Freelance",
		type: "income",
		keywords: ["freelance", "contract", "gig", "consulting"],
	},
	{
		name: "Investment",
		type: "income",
		keywords: ["investment", "dividend", "interest", "stock"],
	},
	{ name: "Gift", type: "income", keywords: ["gift", "present", "birthday"] },
	{
		name: "Refund",
		type: "income",
		keywords: ["refund", "reimbursement", "cashback"],
	},

	// Expense categories
	{
		name: "Food & Drinks",
		type: "expense",
		keywords: ["food", "drinks", "restaurant", "cafe", "lunch", "dinner"],
	},
	{
		name: "Transport",
		type: "expense",
		keywords: ["uber", "bolt", "taxi", "bus", "train", "fuel", "transport"],
	},
	{
		name: "Shopping",
		type: "expense",
		keywords: ["shopping", "mall", "clothes", "amazon", "jumia"],
	},
	{
		name: "Entertainment",
		type: "expense",
		keywords: ["netflix", "spotify", "cinema", "movies", "concert"],
	},
	{
		name: "Bills & Utilities",
		type: "expense",
		keywords: ["electricity", "water", "internet", "bill", "subscription"],
	},
	{
		name: "Groceries",
		type: "expense",
		keywords: ["groceries", "supermarket", "shoprite", "food items"],
	},
	{
		name: "Healthcare",
		type: "expense",
		keywords: ["hospital", "doctor", "medicine", "pharmacy", "health"],
	},
	{
		name: "Education",
		type: "expense",
		keywords: ["school", "tuition", "books", "course", "education"],
	},
	{
		name: "Housing",
		type: "expense",
		keywords: ["rent", "mortgage", "maintenance", "repair"],
	},
	{
		name: "Savings",
		type: "expense",
		keywords: ["savings", "investment", "emergency fund"],
	},
	{
		name: "Transportation",
		type: "expense",
		keywords: ["car", "maintenance", "repair", "insurance"],
	},
	{
		name: "Personal Care",
		type: "expense",
		keywords: ["hair", "spa", "gym", "fitness", "personal care"],
	},
	{
		name: "Travel",
		type: "expense",
		keywords: ["flight", "hotel", "vacation", "travel", "trip"],
	},
	{
		name: "Miscellaneous",
		type: "expense",
		keywords: ["other", "misc", "random"],
	},
];

async function migrateCategories() {
	try {
		// Connect to MongoDB
		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connected to MongoDB");

		// Get all users
		const users = await User.find({});
		console.log(`📊 Found ${users.length} users`);

		let totalCategoriesCreated = 0;
		let usersWithErrors = [];

		for (const user of users) {
			try {
				// Check if user already has categories
				const existingCategories = await Category.countDocuments({
					userId: user._id,
				});

				if (existingCategories > 0) {
					console.log(
						`👤 User ${user.email} already has ${existingCategories} categories. Skipping...`,
					);
					continue;
				}

				// Create all default categories for this user
				const categoriesToCreate = DEFAULT_CATEGORIES.map((cat) => ({
					...cat,
					userId: user._id,
				}));

				await Category.insertMany(categoriesToCreate);
				totalCategoriesCreated += categoriesToCreate.length;
				console.log(
					`✅ Created ${categoriesToCreate.length} categories for ${user.email}`,
				);
			} catch (error) {
				console.error(`❌ Error processing user ${user.email}:`, error.message);
				usersWithErrors.push(user.email);
			}
		}

		console.log("\n📊 Migration Summary:");
		console.log(`✅ Total categories created: ${totalCategoriesCreated}`);
		console.log(`✅ Users processed: ${users.length}`);
		console.log(`❌ Users with errors: ${usersWithErrors.length}`);

		if (usersWithErrors.length > 0) {
			console.log("Users with errors:", usersWithErrors);
		}
	} catch (error) {
		console.error("❌ Migration failed:", error);
	} finally {
		await mongoose.disconnect();
		console.log("🔌 Disconnected from MongoDB");
	}
}

// Run the migration
migrateCategories();
