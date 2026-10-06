// קישורי ניווט למיקום צילום - Waze ו-Google Maps. קידוד מלא של הכתובת (עברית,
// פסיקים) כדי שהאפליקציה תקבל אותה כמו שהוקלדה.
export function wazeUrl(location: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(location.trim())}&navigate=yes`;
}

export function googleMapsUrl(location: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location.trim())}`;
}
