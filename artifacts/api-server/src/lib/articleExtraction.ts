export interface ExtractedPageContent {
    bodyText: string;
    jsonLdText: string;
    author: string;
    publishedTime: string;
}

function decodeHtmlEntities(value: string): string {
    const named: Record<string, string> = {
        amp: "&",
        apos: "'",
        nbsp: " ",
        quot: '"',
        lt: "<",
        gt: ">",
        ndash: "-",
        mdash: "-",
        hellip: "...",
        rsquo: "'",
        lsquo: "'",
        rdquo: '"',
        ldquo: '"',
    };

    return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
        const lower = entity.toLowerCase();
        if (lower[0] === "#") {
            const isHex = lower[1] === "x";
            const code = Number.parseInt(lower.slice(isHex ? 2 : 1), isHex ? 16 : 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }

        return named[lower] ?? match;
    });
}

function stripHtml(value: string): string {
    return decodeHtmlEntities(
        value
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ")
            .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
    );
}

function uniqueJoin(values: string[], maxLength: number): string {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(trimmed);
        if (result.join(" ").length >= maxLength) break;
    }

    return result.join(" ").slice(0, maxLength).trim();
}

function collectParagraphText(html: string): string {
    const paragraphMatches = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
    const paragraphs = paragraphMatches
        .map(match => stripHtml(match[1]))
        .filter(text => text.length >= 40)
        .filter(text => !/^(cookie|privacy|advertisement|subscribe|sign up|all rights reserved)/i.test(text));

    return uniqueJoin(paragraphs, 12000);
}

function findLargestContentBlock(html: string): string {
    const tags = ["article", "main", "section", "div"];
    let best = "";

    for (const tag of tags) {
        const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
        for (const match of html.matchAll(regex)) {
            const text = stripHtml(match[1]);
            if (text.length > best.length) {
                best = text;
            }
        }
        if (best.length >= 1200) break;
    }

    return best;
}

function getObjectString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function collectJsonLdObjects(jsonLd: string): unknown[] {
    return jsonLd
        .split(/\n+/)
        .map(chunk => chunk.trim())
        .filter(Boolean)
        .flatMap(chunk => {
            try {
                const parsed = JSON.parse(chunk);
                return Array.isArray(parsed) ? parsed : [parsed];
            } catch {
                return [];
            }
        });
}

function pickFromJsonLd(jsonLd: string): { text: string; author: string; publishedTime: string } {
    const objects = collectJsonLdObjects(jsonLd);
    const textParts: string[] = [];
    let author = "";
    let publishedTime = "";

    const visit = (value: unknown) => {
        if (!value || typeof value !== "object") return;

        const record = value as Record<string, unknown>;
        const articleBody = getObjectString(record.articleBody);
        const description = getObjectString(record.description);
        const headline = getObjectString(record.headline);

        if (articleBody) textParts.push(articleBody);
        if (headline && description) textParts.push(`${headline}. ${description}`);
        else if (description) textParts.push(description);

        if (!author) {
            const authorValue = record.author;
            if (typeof authorValue === "string") {
                author = authorValue.trim();
            } else if (authorValue && typeof authorValue === "object") {
                author = getObjectString((authorValue as Record<string, unknown>).name);
            } else if (Array.isArray(authorValue)) {
                author = authorValue
                    .map(item => {
                        if (typeof item === "string") return item.trim();
                        if (item && typeof item === "object") return getObjectString((item as Record<string, unknown>).name);
                        return "";
                    })
                    .filter(Boolean)
                    .join(", ");
            }
        }

        if (!publishedTime) {
            publishedTime = getObjectString(record.datePublished) || getObjectString(record.dateCreated);
        }

        const graph = record["@graph"];
        if (Array.isArray(graph)) {
            for (const item of graph) visit(item);
        }

        const mainEntity = record.mainEntity;
        if (mainEntity && typeof mainEntity === "object") {
            visit(mainEntity);
        }
    };

    for (const object of objects) visit(object);

    return {
        text: uniqueJoin(textParts, 12000),
        author,
        publishedTime,
    };
}

export function extractPageContent(html: string, jsonLd: string): ExtractedPageContent {
    const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    const bodyHtml = bodyMatch?.[1] ?? html;

    const paragraphText = collectParagraphText(bodyHtml);
    const largestBlockText = findLargestContentBlock(bodyHtml);
    const jsonLdData = pickFromJsonLd(jsonLd);

    const bodyText = [paragraphText, jsonLdData.text, largestBlockText, stripHtml(bodyHtml)]
        .sort((left, right) => right.length - left.length)
        .find(text => text.length >= 120) ?? "";

    return {
        bodyText: bodyText.slice(0, 12000),
        jsonLdText: jsonLdData.text.slice(0, 4000),
        author: jsonLdData.author,
        publishedTime: jsonLdData.publishedTime,
    };
}
