import type { MetadataRoute } from "next";

/** The installable station: home-screen name, standalone window, the mark at every size. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Claude Radio",
    short_name: "Radio",
    description: "An AI DJ over your records.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#11131f",
    theme_color: "#11131f",
    categories: ["music", "entertainment"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
