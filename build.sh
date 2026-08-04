#!/bin/bash
set -e

echo "==> Injecting secrets into index.html..."

cp index.html index.html.bak

sed -i "s|__FIREBASE_API_KEY__|${FIREBASE_API_KEY}|g"                         index.html
sed -i "s|__FIREBASE_AUTH_DOMAIN__|${FIREBASE_AUTH_DOMAIN}|g"                 index.html
sed -i "s|__FIREBASE_DATABASE_URL__|${FIREBASE_DATABASE_URL}|g"               index.html
sed -i "s|__FIREBASE_PROJECT_ID__|${FIREBASE_PROJECT_ID}|g"                   index.html
sed -i "s|__FIREBASE_STORAGE_BUCKET__|${FIREBASE_STORAGE_BUCKET}|g"           index.html
sed -i "s|__FIREBASE_MESSAGING_SENDER_ID__|${FIREBASE_MESSAGING_SENDER_ID}|g" index.html
sed -i "s|__FIREBASE_APP_ID__|${FIREBASE_APP_ID}|g"                           index.html
sed -i "s|__GAS_ENDPOINT__|${GAS_ENDPOINT}|g"                                 index.html
sed -i "s|__SUPER_ADMIN_HASH__|${SUPER_ADMIN_HASH}|g"                         index.html
sed -i "s|__GROQ_API_KEY__|${GROQ_API_KEY}|g"                                 index.html

echo "==> Verifying no placeholders remain..."
if grep -q "__FIREBASE_\|__GAS_\|__GROQ_\|__SUPER_" index.html; then
  echo "ERROR: Some placeholders were not replaced. Check Netlify environment variables."
  exit 1
fi

echo "==> All secrets injected successfully."
