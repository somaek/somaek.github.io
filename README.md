<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Racing Series Leaderboard</title>
    <!-- Loads Tailwind CSS for styling -->
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        /* Ensures the Inter font is used */
        body {
            font-family: 'Inter', sans-serif;
        }
    </style>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body class="bg-gray-100 p-4 md:p-8">
    <div class="max-w-7xl mx-auto bg-white rounded-lg shadow-xl overflow-hidden">
        <header class="bg-gray-800 text-white p-6">
            <h1 class="text-2xl md:text-3xl font-bold">Our Racing Leaderboard</h1>
        </header>
        <main class="p-4 md:p-6">
            <p class="text-gray-700 mb-6">
                Here are the current standings. You can track all driver progress throughout the season.
            </p>
            <div class="w-full overflow-hidden border border-gray-300 rounded-lg">
                <iframe 
                  src="https://docs.google.com/spreadsheets/d/e/2PACX-1vTFFpRBp56INVL1XqmHbGBrISvVdzqQ1C3N-sf9xox4oJugyPqYw7OwbxpkyolEjx8BPIkd7mb2ICza/pubhtml?gid=745704294&amp;single=true&amp;widget=true&amp;headers=false"
                  class="w-full h-[70vh] md:h-[80vh]"
                  style="border: 0;"
                  allowfullscreen="" 
                  loading="lazy" 
                  referrerpolicy="no-referrer-when-downgrade">
                </iframe>
            </div>
        </main>
        <footer class="p-6 bg-gray-50 border-t border-gray-200">
            <p class="text-center text-gray-500 text-sm">
                &copy; 2025 Your Race Series. All rights reserved.
            </p>
        </footer>
    </div>
</body>
</html>
