from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.goto("http://localhost:3005/palette-test")
    page.wait_for_timeout(2000)
    page.get_by_role("button", name="More actions").hover()
    page.wait_for_timeout(1000)
    page.screenshot(path="verification/screenshots/tooltip_more_actions.png")
    page.wait_for_timeout(1000)
    page.get_by_role("button", name="Copy").hover()
    page.wait_for_timeout(1000)
    page.screenshot(path="verification/screenshots/tooltip_copy.png")
    page.wait_for_timeout(2000)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(record_video_dir="verification/videos")
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()
            browser.close()
