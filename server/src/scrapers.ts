import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

export async function scrapeChapterImages(chapterUrl: string): Promise<string[]> {
  // Launch the browser (add { headless: false } for debugging if needed)
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    
    // Set a realistic viewport and User-Agent to look like a normal user
    await page.setViewport({ width: 1280, height: 800 });
    
    // Navigate to the chapter page and wait for the DOM to load
    await page.goto(chapterUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // NOTE: This selector will change depending on the site you are scraping.
    // Inspect the target site to find the class wrapping the chapter images.
    const imageSelector = ".reading-content img"; 
    
    // Wait for the images to appear in the DOM
    await page.waitForSelector(imageSelector, { timeout: 10000 });

    // Extract the image URLs using puppeteer's built-in methods
    const imageUrls = await page.$$eval(imageSelector, (elements: any[]) => {
      return elements.map((img: any) => {
        // Some sites use data-src for lazy loading, so check that first
        return img.getAttribute("data-src") || img.getAttribute("src") || "";
      }).filter((src: string) => src.trim() !== "");
    });

    return imageUrls;
  } catch (error) {
    console.error("Error scraping chapter:", error);
    throw new Error("Failed to scrape chapter images");
  } finally {
    await browser.close();
  }
}