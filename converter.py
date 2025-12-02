import json
import sys
import os
from datetime import datetime

# --- Configuration ---
# ASSUMPTION: The script assumes the following mapping based on typical track data:
# 'y' in the JSON is converted to Latitude (lat)
# 'x' in the JSON is converted to Longitude (lon)
# 'z' in the JSON is converted to Elevation (ele)

def convert_to_gpx(json_filepath):
    """
    Reads a custom JSON file and converts its track data into a standard GPX format.
    """
    try:
        # 1. Load the JSON data
        with open(json_filepath, 'r') as f:
            data = json.load(f)

    except FileNotFoundError:
        print(f"Error: Input file not found at '{json_filepath}'")
        return
    except json.JSONDecodeError:
        print(f"Error: Failed to decode JSON from '{json_filepath}'. Please check the file format.")
        return
    except Exception as e:
        print(f"An unexpected error occurred during file reading: {e}")
        return

    # 2. Extract key data
    track_name = data.get('name', 'Untitled Track')

    # Attempt to locate coordinates. Based on the snippet, they are in 'leadin.coordinates'.
    coordinates = data.get('leadin', {}).get('coordinates', [])

    if not coordinates:
        print("Warning: Could not find 'coordinates' list under 'leadin'. Checking top-level arrays...")
        # Fallback in case coordinates are structured differently (e.g., an array of segments)
        if isinstance(data, dict):
            # Try to find a list of coordinate dictionaries directly in a key value
            for key, value in data.items():
                if isinstance(value, list) and all(isinstance(p, dict) and all(c in p for c c in ['x', 'y', 'z']) for p in value):
                    coordinates = value
                    print(f"Found coordinates in key: {key}")
                    break

        if not coordinates:
            print("Error: No valid coordinate data found. Ensure track points are a list of {'x', 'y', 'z'} objects.")
            return

    # 3. Build the GPX track points (trkpt) string
    track_points_xml = []

    for point in coordinates:
        try:
            lat = point['y']
            lon = point['x']
            ele = point['z']

            # Use current time as a placeholder for  if no time data exists
            time_str = datetime.utcnow().isoformat() + 'Z'

            trkpt = (
                f'    \n'
                f'      {ele:.2f}\n'
                f'      {time_str}\n'
                f'    '
            )
            track_points_xml.append(trkpt)
        except KeyError as e:
            print(f"Warning: Skipping point due to missing key {e}. Point data: {point}")
            continue

    if not track_points_xml:
        print("Error: Failed to generate any track points. Check the coordinate format.")
        return

    # 4. Assemble the full GPX XML structure
    gpx_content = f"""


  

  
    {track_name}
    
{'\n'.join(track_points_xml)}
    
  

"""

    # 5. Save the output file
    base_name = os.path.splitext(json_filepath)[0]
    gpx_filepath = base_name + '.gpx'

    with open(gpx_filepath, 'w') as f:
        f.write(gpx_content)

    print(f"\nSuccessfully converted '{json_filepath}' to '{gpx_filepath}'.")
    print(f"Track Name: {track_name}")
    print(f"Total Track Points Converted: {len(track_points_xml)}")


# --- Original main block modified for Colab usage ---
if __name__ == "__main__":
    is_colab_run = False
    if len(sys.argv) == 1: # Typical Colab execution with no explicit arguments
        is_colab_run = True
    elif len(sys.argv) > 1 and sys.argv[1] == '-f': # Handle Colab's potential internal '-f' argument
        is_colab_run = True

    if is_colab_run:
        print("\n--- Running in Colab environment (demonstration mode) ---")
        print("To use the `convert_to_gpx` function with your own file, call it directly:")
        print("  convert_to_gpx('your_input_file.json')")
        print("\n--- Example: Creating a dummy JSON file and converting it ---")

        # Create a dummy JSON file for demonstration
        dummy_json_data = {
            "name": "Colab Test Track",
            "leadin": {
                "coordinates": [
                    {"x": -74.0060, "y": 40.7128, "z": 10.5},
                    {"x": -74.0055, "y": 40.7132, "z": 12.1},
                    {"x": -74.0050, "y": 40.7136, "z": 11.8}
                ]
            }
        }
        dummy_filename = "dummy_track.json"
        with open(dummy_filename, 'w') as f:
            json.dump(dummy_json_data, f, indent=2)
        print(f"Created '{dummy_filename}' with sample data.")

        # Now call the function with the dummy file
        convert_to_gpx(dummy_filename)
    else:
        # Assume command-line execution with a valid file path
        if len(sys.argv) > 1:
            input_file = sys.argv[1]
            convert_to_gpx(input_file)
        else:
            print("Usage: python json_to_gpx.py ")
            sys.exit(1)
