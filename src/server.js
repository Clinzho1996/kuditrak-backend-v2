import app from "./app.js";

const PORT = process.env.PORT || 5000;

// Start server IMMEDIATELY - don't wait for anything
app.listen(PORT, () => {
	console.log(`✅ Kuditrak V2 backend running on port ${PORT}`);
	console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
});

// Everything else runs in background
