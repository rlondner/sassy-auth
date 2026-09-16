export function renderRedocPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SassyAuth API Docs (ReDoc)</title>
  <style>
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div id="redoc-container"></div>
  <script src="/api/redoc-bundle.js"></script>
  <script src="/api/redoc-init.js"></script>
</body>
</html>
`;
}
