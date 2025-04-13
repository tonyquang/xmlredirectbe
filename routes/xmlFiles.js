const express = require("express");
const axios = require("axios");
const { writeFile } = require("fs/promises");
const { join } = require("path");
const { prisma } = require("../lib/prisma"); // assuming prisma.js uses module.exports

const http = require("http");
const https = require("https");

const router = express.Router();

// GET /api/xml-files?page=1&limit=10
router.get("/", async (req, res) => {
    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "10", 10);
    const skip = (page - 1) * limit;

    try {
        const [files, total] = await Promise.all([
            prisma.xmlFile.findMany({
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
            }),
            prisma.xmlFile.count(),
        ]);

        res.json({
            data: files,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

// POST /api/xml-files
router.post("/", async (req, res) => {
    const { urls } = req.body;
    console.log(req.body);
    if (!Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: "URLs required" });
    }

    const uniqueUrls = [...new Set(urls)];

    const existingRecords = await prisma.xmlFile.findMany({
        where: {
            originalUrl: {
                in: uniqueUrls,
            },
        },
        select: {
            originalUrl: true,
        },
    });

    const existingUrlsSet = new Set(existingRecords.map((r) => r.originalUrl));
    const existingResults = uniqueUrls
        .filter((url) => existingUrlsSet.has(url))
        .map((url) => ({ url, status: "already exists" }));

    const urlsToDownload = uniqueUrls.filter(
        (url) => !existingUrlsSet.has(url)
    );
    // Correctly pass concurrency value to pLimit
    const pLimit = await import("p-limit").then((mod) => mod.default); // Dynamically import p-limit
    const limit = pLimit(5); // Set concurrency to 5

    const tasks = urlsToDownload.map((url) =>
        limit(async () => {
            try {
                const response = await axios.get(url, {
                    responseType: "text",
                    timeout: 10000,
                    transitional: { clarifyTimeoutError: true },
                    httpAgent: new http.Agent({ family: 4 }),
                    httpsAgent: new https.Agent({ family: 4 }),
                });

                const segments = url.split("/");
                const userId = segments[segments.length - 2];
                const filePart = segments[segments.length - 1];
                const fileName = `${userId}_${filePart}`;
                const localPath = `/files/original/${fileName}`;
                const fullPath = join(process.cwd(), "public", localPath);

                await writeFile(fullPath, response.data);

                await prisma.xmlFile.create({
                    data: {
                        originalUrl: url,
                        localPath,
                        status: "downloaded",
                    },
                });

                return { url, status: "downloaded", path: localPath };
            } catch (err) {
                console.error(`Failed to download ${url}:`, err.message);
                return { url, status: "error", message: err.message };
            }
        })
    );

    const downloadedResults = await Promise.all(tasks);
    return res.json({ results: [...existingResults, ...downloadedResults] });
});

// DELETE /api/xml-files/:id
router.delete("/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);

    try {
        const file = await prisma.xmlFile.findUnique({
            where: { id },
        });

        if (!file) {
            return res.status(404).json({ error: "Not found" });
        }

        const fullPath = join(process.cwd(), "public", file.localPath);

        try {
            await unlink(fullPath);
        } catch (err) {
            console.warn("File already removed or not found:", fullPath);
        }

        await prisma.xmlFile.delete({
            where: { id },
        });

        return res.json({ success: true });
    } catch (error) {
        console.error("Delete failed:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;
