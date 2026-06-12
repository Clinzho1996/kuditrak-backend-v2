// backend/scripts/testAnchor.js
import axios from "axios";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const testAnchor = async () => {
	console.log("Testing Anchor API...");

	try {
		const response = await axios.post(
			`${process.env.ANCHOR_BASE_URL}/customers`,
			{
				data: {
					type: "IndividualCustomer",
					attributes: {
						fullName: {
							firstName: "Test",
							lastName: "User",
						},
						address: {
							addressLine_1: "123 Test Street",
							city: "Lagos",
							state: "Lagos",
							postalCode: "100001",
							country: "NG",
						},
						email: "test@example.com",
						phoneNumber: "08012345678",
					},
				},
			},
			{
				headers: {
					"x-anchor-key": process.env.ANCHOR_API_KEY,
					"Content-Type": "application/json",
				},
			},
		);

		console.log("✅ Anchor API working!");
		console.log("Customer ID:", response.data?.data?.id);
	} catch (error) {
		console.error(
			"❌ Anchor API error:",
			error.response?.data || error.message,
		);
	}
};

testAnchor();
