/**
 * The sticker set: critique vocabulary, animated.
 *
 * The art is Google's Noto animated emoji (open license), bundled as WebP at
 * build time — the beating heart and flickering flame ship inside the app,
 * no service, no key, no runtime dependency. The emoji character remains the
 * stored value and the fallback glyph; the animation is presentation.
 */
import heart from "../assets/stickers/heart.webp";
import fire from "../assets/stickers/fire.webp";
import thinking from "../assets/stickers/thinking.webp";
import confused from "../assets/stickers/confused.webp";
import cut from "../assets/stickers/cut.webp";
import idea from "../assets/stickers/idea.webp";
import party from "../assets/stickers/party.webp";
import eyes from "../assets/stickers/eyes.webp";

export const STICKER_SET = ["❤️", "🔥", "🤔", "😕", "✂️", "💡", "🎉", "👀"] as const;

export const STICKER_ART: Record<string, string> = {
  "❤️": heart,
  "🔥": fire,
  "🤔": thinking,
  "😕": confused,
  "✂️": cut,
  "💡": idea,
  "🎉": party,
  "👀": eyes,
};

export const STICKER_NAMES: Record<string, string> = {
  "❤️": "Love it",
  "🔥": "Ship it",
  "🤔": "Not sure",
  "😕": "Confusing",
  "✂️": "Cut it",
  "💡": "Idea",
  "🎉": "Celebrate",
  "👀": "Look at this",
};
