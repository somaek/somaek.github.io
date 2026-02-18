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

def get_denver_time(time_str, date_str):
    """
    Converts a time string (HH:MM) and date string from Belgium time to Denver time.
    """
    if not time_str or ":" not in time_str:
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
        "Startlist quality score": ""
    }
    
    try:
        response = requests.get(race_url)
        if response.status_code != 200:
            return details
        
        soup = BeautifulSoup(response.text, 'html.parser')
        info_list = soup.find('ul', class_='infolist')
        
        if info_list:
            items = info_list.find_all('li')
            for item in items:
                text = item.get_text(separator="|").strip()
                parts = [p.strip() for p in text.split('|')]
                
                if len(parts) >= 2:
                    key = parts[0].replace(":", "")
                    value = parts[1]
                    if key in details:
                        details[key] = value
                    # Handle slight variations in naming
                    elif key == "Startlist quality score":
                        details["Startlist quality score"] = value
    except Exception as e:
        print(f"Error scraping details for {race_url}: {e}")
        
    return details

def main():
    print(f"Starting scrape of {CALENDAR_URL}...")
    response = requests.get(CALENDAR_URL)
    soup = BeautifulSoup(response.text, 'html.parser')
    
    table = soup.find('table', class_='basic')
    if not table:
        print("Could not find the race table.")
        return

    rows = table.find('tbody').find_all('tr')
    all_data = []

    for row in rows:
        cols = row.find_all('td')
        if len(cols) < 5:
            continue
            
        date = cols[0].text.strip()
        local_start = cols[1].text.strip()
        race_cell = cols[2]
        race_name = race_cell.text.strip()
        belgium_start = cols[3].text.strip()
        belgium_finish = cols[4].text.strip()
        
        # Extract link to race page
        race_link_tag = race_cell.find('a')
        race_details = {
            "Classification": "", "Distance": "", 
            "ProfileScore": "", "Startlist quality score": ""
        }
        
        if race_link_tag:
            race_href = race_link_tag['href']
            full_race_url = BASE_URL + race_href
            print(f"Fetching details for: {race_name}")
            race_details = scrape_race_details(full_race_url)
            # Be polite to the server
            time.sleep(0.5)

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
            "Startlist Quality Score": race_details["Startlist quality score"]
        })

    # Write to CSV
    keys = all_data[0].keys()
    with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as f:
        dict_writer = csv.DictWriter(f, fieldnames=keys)
        dict_writer.writeheader()
        dict_writer.writerows(all_data)
    
    print(f"Successfully saved {len(all_data)} races to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
