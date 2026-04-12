# Design System: Marine Editorial & Precision

## 1. Overview & Creative North Star

### The Creative North Star: "The Nautical Curator"
This design system rejects the "SaaS dashboard" aesthetic in favor of a high-end editorial experience. It balances the life-critical precision of marine mission control with the tactile, sophisticated feel of a premium architectural journal. 

By utilizing **intentional asymmetry**, **tonal layering**, and **wide-set typography**, we move away from generic grids. The goal is "print-first" usability—where every screen could be exported as a high-fidelity PDF report for a ship’s captain, maintaining absolute authority and elegance. We do not use borders to separate ideas; we use space, light, and depth.

---

## 2. Colors

The palette is anchored in warm, organic tones that reduce eye strain on bridge monitors while maintaining a luxury feel.

### Core Tones
- **Background (`surface`):** `#FBF9F4` (Warm White). The base of the "paper."
- **Panels (`surface-container`):** `#EFEEE6` to `#E2E3D9`. Used for tactile cargo blocks and mission-control sidebars.
- **Typography (`on-surface`):** `#31332C` (Deep Charcoal). High-contrast but softer than pure black to prevent visual vibration.
- **Operational Accents:** 
    - **Tertiary (`#785A1A`):** Muted Gold/Bronze for Warnings and Dangerous Goods (DG).
    - **Secondary (`#486083`):** Premium Navy for critical operational markers and navigation paths.

### The "No-Line" Rule
**Explicit Instruction:** 1px solid borders are prohibited for sectioning. 
Boundaries must be defined solely through:
1.  **Background Color Shifts:** A `surface-container-low` section sitting on a `surface` background.
2.  **Tonal Transitions:** Using `outline-variant` (`#B1B3A9`) at 10-20% opacity only if a physical limit is required for accessibility.

### Glass & Texture
For floating "Mission Control" overlays (like cargo detail modals), use **Glassmorphism**. Combine `surface-container-lowest` (`#FFFFFF`) at 85% opacity with a `20px` backdrop-blur. This ensures the deck plan remains visible beneath the active task, creating an integrated, non-disruptive layer.

---

## 3. Typography

The system utilizes a dual-font strategy to balance character and readability.

*   **Display & Headlines (Manrope):** Chosen for its geometric precision and wide apertures. Use `headline-lg` (2rem) for vessel names and major deck sections.
*   **Body & Labels (Inter):** The workhorse for operational data. Inter's tall x-height ensures readability of container IDs and weights even at `label-sm` (0.6875rem).

**Hierarchy as Identity:**
- **The "Data Header" Pattern:** Large, low-weight display numbers (e.g., total tonnage) paired with small, all-caps labels in `secondary` navy creates an authoritative, "bridge-instrument" feel.

---

## 4. Elevation & Depth

We eschew traditional drop shadows for **Tonal Layering**.

### The Layering Principle
Depth is achieved by stacking containers. 
- **Level 0:** `surface` (#FBF9F4) - The Deck / Ocean.
- **Level 1:** `surface-container-low` (#F5F4ED) - Primary working areas.
- **Level 2:** `surface-container` (#EFEEE6) - Individual Cargo Blocks.
- **Level 3:** `surface-container-highest` (#E2E3D9) - High-priority active selection.

### Ambient Shadows
When an element must "float" (e.g., a cargo drag-and-drop), use a shadow tinted with the `on-surface` color:
- **Value:** `0px 12px 32px rgba(49, 51, 44, 0.06)`
- This creates a soft, natural lift that feels like physical paper on a desk, not a digital button.

---

## 5. Components

### Cargo Blocks (Cards)
- **Style:** Use `rounded-md` (0.75rem). No borders.
- **Internal Logic:** Use `body-sm` for secondary metadata (Weight/Dimensions).
- **DG Markers:** Dangerous Goods must use a `tertiary-container` (#FBD185) background with `on-tertiary-fixed` (#4A3400) text.

### Buttons
- **Primary:** `primary` (#5F5E5E) background with `on-primary` (#FAF7F6) text. High contrast, professional.
- **Secondary:** Transparent background with an `outline-variant` ghost border at 20% opacity. 
- **Shape:** All buttons use `full` rounding (pill-shape) to contrast against the rectangular "cargo" blocks of the deck plan.

### Data Inputs
- **Style:** `surface-container-lowest` (#FFFFFF) fills. 
- **Focus State:** Subtle `secondary` (#486083) 1px "Ghost Border." Avoid heavy glow effects.

### Critical Operational Markers (Badges)
- Use `secondary` (#486083) for voyage numbers and GPS coordinates. This "Premium Navy" is the only color allowed to break the warm-tone palette, signaling its importance.

---

## 6. Do's and Don'ts

### Do
- **Use "Breathing Room":** If a piece of data feels crowded, increase the padding rather than adding a divider line.
- **Respect the Grid:** Align typography to the baseline of adjacent cargo blocks to maintain "Mission Control" precision.
- **Print-Ready Design:** Ensure all text passes AA accessibility against the warm-white background.

### Don't
- **No Pure Black:** Never use `#000000`. It breaks the editorial "ink-on-paper" feel.
- **No Heavy Borders:** Never use high-contrast dividers. Use a `16px` or `24px` vertical gap instead.
- **No Default System Shadows:** Standard "Material" or "Bootstrap" shadows are too dark and "cheapen" the luxury marine aesthetic. Always use the tinted Ambient Shadow.