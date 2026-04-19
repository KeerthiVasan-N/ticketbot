A high-speed, interactive web automation tool designed for competitive ticket-booking environments (like IPL on District.in). It combines a browser-based element picker with a Node.js polling engine to achieve sub-100ms reaction times.

⚡ Key Features
Interactive Element Picker: No need to inspect code. Hover and click to select the exact button you want to monitor.

Dual-Stage Automation:

Stage 1: Clicks the "Book tickets" card on the listing page the millisecond it becomes active.

Stage 2: Automatically navigates the SPA and clicks the final "Book Tickets" button on the event detail page.

Lightning Fast: Configurable 50ms polling loop and MutationObserver injection for "Zero-Day" click speeds.

Stealth Integrated: Uses puppeteer-extra-plugin-stealth to minimize detection by anti-bot services.

WhatsApp Ready: Placeholder hooks included for real-time alerts when you successfully enter the queue.
