// Capybara palette — warm, expressive, a little rosy.
export const C = {
  // Body
  body: "#9E6E34",         // warm brown (slightly brighter main body)
  bodyLight: "#C8975F",    // belly / snout highlight
  bodyDark: "#6D471B",     // back / contour shading
  bodyShade: "#462F10",    // deepest shadow (rare accent)

  // Face
  nose: "#2B1A0A",         // nose tip
  mouth: "#3A2410",        // mouth crease
  eye: "#1A1A1A",          // eye pupil
  eyeShine: "#FFFFFF",     // eye highlight
  eyeClosed: "#3A2410",    // closed-eye line (for blink / sleep)

  // Ears
  ear: "#865723",          // ear outer
  earInner: "#E9A89E",     // soft pink ear interior

  // Cheeks / blush
  cheek: "#C49A6C",        // snout tone highlight
  blush: "#F5A5A0",        // rosy cheek blush

  // Feet
  feet: "#5F4118",         // hooves

  // Iconic yuzu citrus on head (Japanese onsen capybara motif)
  yuzu: "#F5C244",
  yuzuShade: "#D89A20",
  yuzuLeaf: "#6BA84A",

  // Props
  hat: "#4A90D9",
  hatDark: "#2E6CA8",

  // Particles
  sweat: "#7FC8F8",
  sweatDark: "#3F9CD8",
  zzz: "#9CA3AF",
  sparkle: "#FFD700",
  sparkleAccent: "#FFA94D",
  heart: "#EF4444",
  heartLight: "#FB7185",
  water: "#7FC8F8",
  waterDark: "#3F9CD8",
  splash: "#BDE4FD",
  dust: "#D8C3A0",         // dust puff on landing
  note: "#7C5CFA",         // music note accent

  // UI
  bubble: "#FFFFFF",
  bubbleBorder: "#D1D5DB",
  shadow: "rgba(0, 0, 0, 0.22)", // ground shadow ellipse
} as const;

// Transparent pixel
export const _ = null;
