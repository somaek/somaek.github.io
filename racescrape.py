import requests
from bs4 import BeautifulSoup
import csv
import datetime
import pytz
import time

# Configuration
BASE_URL = "https://www.procyclingstats.com/"
CALENDAR_URL = "https://www.procyclingstats.com/calendar/start-finish-schedule"
OUTPUT_FILE = "race_schedule.csv"

# Headers to mimic a real browser and avoid being blocked
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

def get_denver_time(time_str, date_str):
    """
    Converts a time string (HH:MM) and date string from Belgium time to Denver time.
    """
    if not time_str or ":" not in time_str or time_str == "-":
        return ""
    
    try:
        # Belgium is typically CET (UTC+1) or CEST (UTC+2)
        belgium_tz = pytz.timezone("Europe/Brussels")
        denver_tz = pytz.timezone("America/Denver")
        
        # Parse the date and time
        # Date format on PCS is usually "19 February 2026"
        full_dt_str = f"{date_str} {time_str}"
        dt = datetime.datetime.strptime(full_dt_str, "%d %B %Y %H:%M")
        
        # Localize to Belgium time
        belgium_dt = belgium_tz.localize(dt)
        # Convert to Denver
        denver_dt = belgium_dt.astimezone(denver_tz)
        
        return denver_dt.strftime("%H:%M")
    except Exception:
        return time_str

def scrape_race_details(race_url):
    """
    Scrapes specific metadata from an individual race page.
    """
    details = {
        "Classification": "",
        "Distance": "",
        "ProfileScore": "",
        "Startlist Quality Score": ""
    }
    
    try:
        response = requests.get(race_url, headers=HEADERS, timeout=10)
        if response.status_code != 200:
            return details
        
        soup = BeautifulSoup(response.text, 'html.parser')
        info_list = soup.find('ul', class_='infolist')
        
        if info_list:
            items = info_list.find_all('li')
            for item in items:
                # Use a separator to make splitting easier
                text_content = item.get_text(separator="|").strip()
                parts = [p.strip() for p in text_content.split('|')]
                
                if len(parts) >= 2:
                    key = parts[0].replace(":", "").strip()
                    value = parts[1].strip()
                    
                    if key == "Classification":
                        details["Classification"] = value
                    elif key == "Distance":
                        details["Distance"] = value
                    elif key == "ProfileScore":
                        details["ProfileScore"] = value
                    elif "Startlist quality score" in key:
                        details["Startlist Quality Score"] = value
    except Exception as e:
        print(f"Error scraping details for {race_url}: {e}")
        
    return details

def main():
    print(f"Starting scrape of {CALENDAR_URL}...")
    try:
        response = requests.get(CALENDAR_URL, headers=HEADERS, timeout=10)
        response.raise_for_status()
    except Exception as e:
        print(f"Failed to fetch calendar page: {e}")
        return

    soup = BeautifulSoup(response.text, 'html.parser')
    
    # PCS often uses 'table.basic' or sometimes just identifies it by content
    table = soup.find('table', class_='basic')
    
    if not table:
        # Fallback: try finding any table with "Race" in the header
        tables = soup.find_all('table')
        for t in tables:
            if "Race" in t.get_text():
                table = t
                break
    
    if not table:
        print("Could not find the race table. The page structure might have changed.")
        # Debug: Print a snippet of the HTML to help diagnose if this happens again
        return

    rows = table.find('tbody').find_all('tr') if table.find('tbody') else table.find_all('tr')
    all_data = []

    for row in rows:
        cols = row.find_all('td')
        # Expecting at least: Date, Local, Race, Start, Finish
        if len(cols) < 5:
            continue
            
        date = cols[0].text.strip()
        local_start = cols[1].text.strip()
        race_cell = cols[2]
        race_name = race_cell.text.strip()
        belgium_start = cols[3].text.strip()
        belgium_finish = cols[4].text.strip()
        
        # Skip header rows that might be mixed in
        if "Race" in race_name or not date:
            continue

        # Extract link to race page
        race_link_tag = race_cell.find('a')
        race_details = {
            "Classification": "", "Distance": "", 
            "ProfileScore": "", "Startlist Quality Score": ""
        }
        
        if race_link_tag and race_link_tag.has_attr('href'):
            race_href = race_link_tag['href']
            # Handle relative vs absolute URLs
            full_race_url = race_href if race_href.startswith('http') else BASE_URL + race_href
            print(f"Fetching details for: {race_name}")
            race_details = scrape_race_details(full_race_url)
            # Be polite to the server
            time.sleep(1)

        # Convert times to Denver
        denver_start = get_denver_time(belgium_start, date)
        denver_finish = get_denver_time(belgium_finish, date)

        all_data.append({
            "Date": date,
            "Local Starttime": local_start,
            "Race": race_name,
            "Starttime (Denver)": denver_start,
            "Expected Finishtime (Denver)": denver_finish,
            "Classification": race_details["Classification"],
            "Distance": race_details["Distance"],
            "ProfileScore": race_details["ProfileScore"],
            "Startlist Quality Score": race_details["Startlist Quality Score"]
        })

    if not all_data:
        print("No race data was extracted. Check table parsing logic.")
        return

    # Write to CSV
    keys = all_data[0].keys()
    with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as f:
        dict_writer = csv.DictWriter(f, fieldnames=keys)
        dict_writer.writeheader()
        dict_writer.writerows(all_data)
    
    print(f"Successfully saved {len(all_data)} races to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
