import axios from "axios";

export const paystack = axios.create({
	baseURL: "https://api.paystack.co",
	headers: {
		Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
		"Content-Type": "application/json",
	},
});
