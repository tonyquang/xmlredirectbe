const express = require("express");
const dotenv = require("dotenv");
const morgan = require("morgan");
const path = require("path");
const xmlFileRoutes = require("./routes/xmlFiles");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
app.use(morgan("combined")); // You can also use 'combined', 'tiny', etc.

app.use(express.json());
app.use("/files", express.static(path.join(process.cwd(), "public")));
app.use("/api/xml-files", xmlFileRoutes);

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
