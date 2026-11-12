import qrcode
from io import BytesIO
import html
import time
from pathlib import Path

import folium
import pandas as pd
import streamlit as st
from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter
from streamlit_folium import st_folium

# ------------------------------------------------------------
# Niagara Falls Homeless Services Map
# Addresses transcribed from the user's reference image.
# ------------------------------------------------------------

st.set_page_config(
    page_title="Niagara Falls Homeless Services Map",
    page_icon="📍",
    layout="wide",
)

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
LOCATIONS_FILE = DATA_DIR / "locations.csv"
CACHE_FILE = DATA_DIR / "geocoded_locations.csv"

CITY_SUFFIX = "Niagara Falls, NY, USA"

# ------------------------------------------------------------
# QR CODE GENERATOR
# ------------------------------------------------------------

APP_URL = "https://niagragospelmap.streamlit.app/"

qr = qrcode.QRCode(
    version=1,
    box_size=10,
    border=4
)

qr.add_data(APP_URL)
qr.make(fit=True)

qr_image = qr.make_image(
    fill_color="black",
    back_color="white"
)

buffer = BytesIO()
qr_image.save(buffer, format="PNG")

COLORS = [
    "#C62828", "#EF6C00", "#7B1FA2", "#2E7D32",
    "#00838F", "#1565C0", "#558B2F", "#33691E",
    "#283593", "#0097A7", "#F57C00", "#6A1B9A",
    "#0D47A1", "#2E7D32", "#8E24AA", "#558B2F",
]


@st.cache_data
def load_locations():
    data = pd.read_csv(LOCATIONS_FILE).fillna("")
    data["id"] = data["id"].astype(int)
    data["full_address"] = data["street_address"].astype(str) + ", " + CITY_SUFFIX
    return data


def load_geocode_cache():
    if CACHE_FILE.exists():
        cached = pd.read_csv(CACHE_FILE)
        if {"id", "latitude", "longitude"}.issubset(cached.columns):
            return cached
    return pd.DataFrame(columns=["id", "latitude", "longitude", "matched_address"])


def save_geocode_cache(cache):
    DATA_DIR.mkdir(exist_ok=True)
    cache.to_csv(CACHE_FILE, index=False)


def geocode_locations(data):
    """Geocode only locations missing from the local cache.

    Nominatim is a public OpenStreetMap geocoder. This app deliberately
    spaces requests by at least one second and saves results locally.
    For production/high-volume use, use a commercial geocoding provider
    or host your own geocoder.
    """
    cache = load_geocode_cache()
    cache["id"] = pd.to_numeric(cache.get("id"), errors="coerce")
    known_ids = set(cache["id"].dropna().astype(int).tolist())

    missing = data[~data["id"].isin(known_ids)]
    if missing.empty:
        return cache

    geolocator = Nominatim(user_agent="niagara_falls_services_map_student_project")
    geocode = RateLimiter(
        geolocator.geocode,
        min_delay_seconds=1.1,
        max_retries=2,
        error_wait_seconds=2.0,
        swallow_exceptions=True,
    )

    progress = st.progress(0, text="Finding coordinates for service addresses...")
    new_rows = []

    for index, row in enumerate(missing.itertuples(index=False), start=1):
        result = geocode(row.full_address)
        if result is None:
            # A second query without the state/country suffix can sometimes help.
            result = geocode(f"{row.street_address}, Niagara Falls, New York")

        if result:
            new_rows.append({
                "id": int(row.id),
                "latitude": float(result.latitude),
                "longitude": float(result.longitude),
                "matched_address": result.address,
            })
        else:
            new_rows.append({
                "id": int(row.id),
                "latitude": None,
                "longitude": None,
                "matched_address": "Address not found — check address manually",
            })

        progress.progress(index / len(missing), text=f"Geocoding address {index} of {len(missing)}...")
    progress.empty()

    updated = pd.concat([cache, pd.DataFrame(new_rows)], ignore_index=True)
    updated = updated.drop_duplicates(subset=["id"], keep="last")
    save_geocode_cache(updated)
    return updated


def make_numbered_icon(number, color):
    return folium.DivIcon(
        html=f"""
        <div style="
            background:{color};
            color:white;
            border:2px solid white;
            border-radius:50%;
            width:31px;
            height:31px;
            line-height:27px;
            text-align:center;
            font-weight:800;
            font-size:14px;
            box-shadow:0 2px 6px rgba(0,0,0,.45);
        ">{number}</div>
        """,
        icon_size=(31, 31),
        icon_anchor=(15, 15),
    )


def build_map(mapped_data):
    map_object = folium.Map(
        location=[43.0962, -79.0377],
        zoom_start=14,
        tiles="OpenStreetMap",
        control_scale=True,
    )

    bounds = []
    for row in mapped_data.itertuples(index=False):
        if pd.isna(row.latitude) or pd.isna(row.longitude):
            continue

        color = COLORS[(int(row.id) - 1) % len(COLORS)]
        safe_name = html.escape(str(row.name))
        safe_address = html.escape(str(row.full_address))
        safe_phone = html.escape(str(row.phone)) if row.phone else "Not listed"
        safe_category = html.escape(str(row.category))

        popup_html = f"""
        <div style="font-family:Arial; width:220px;">
          <h4 style="margin:0 0 7px 0;">{row.id}. {safe_name}</h4>
          <div><b>Address:</b> {safe_address}</div>
          <div><b>Phone:</b> {safe_phone}</div>
          <div><b>Services:</b> {safe_category}</div>
        </div>
        """

        folium.Marker(
            location=[row.latitude, row.longitude],
            tooltip=f"{row.id}. {row.name}",
            popup=folium.Popup(popup_html, max_width=300),
            icon=make_numbered_icon(row.id, color),
        ).add_to(map_object)

        bounds.append([row.latitude, row.longitude])

    if bounds:
        map_object.fit_bounds(bounds, padding=(25, 25))
    return map_object


st.markdown(
    """
    <style>
      .main-title {font-size:2rem;font-weight:800;color:#12345a;margin-bottom:0;}
      .sub-title {color:#64748b;margin-top:0.2rem;}
      .location-card {
        border:1px solid #d9e2ec;border-radius:10px;padding:10px 12px;
        margin-bottom:8px;background:var(--secondary-background-color);
      }
      .location-name {font-weight:700;font-size:0.94rem;}
      .location-detail {font-size:0.82rem;color:var(--text-color);margin-top:3px;}
      .pin-number {
        display:inline-flex;align-items:center;justify-content:center;
        width:25px;height:25px;border-radius:50%;color:white;
        font-weight:800;margin-right:7px;vertical-align:middle;
      }
    </style>
    """,
    unsafe_allow_html=True,
)

st.markdown('<div class="main-title">Niagara Falls Homeless Services Map</div>', unsafe_allow_html=True)
st.markdown('<div class="sub-title">Support • Resources • Hope | Niagara Falls, New York</div>', unsafe_allow_html=True)
st.divider()

locations = load_locations()

with st.sidebar:
    st.header("Map controls")

    search_text = st.text_input("Search organization or address")
    show_phone = st.checkbox("Show phone numbers", value=True)

    st.caption(
        "Map coordinates are looked up using OpenStreetMap's Nominatim service."
    )

    if st.button("Re-geocode all addresses", use_container_width=True):
        if CACHE_FILE.exists():
            CACHE_FILE.unlink()
        st.rerun()

    # QR CODE SECTION
    st.divider()
    st.subheader("Access Map by QR Code")

    st.image(
        buffer.getvalue(),
        caption="Scan to access Niagara Falls Services Map"
    )

    st.download_button(
        label="Download QR Code",
        data=buffer.getvalue(),
        file_name="niagara_falls_services_qr.png",
        mime="image/png"
    )

# Geocode once; results are stored in data/geocoded_locations.csv.
with st.spinner("Loading map locations..."):
    geo_cache = geocode_locations(locations)

mapped = locations.merge(geo_cache, on="id", how="left")
mapped["latitude"] = pd.to_numeric(mapped["latitude"], errors="coerce")
mapped["longitude"] = pd.to_numeric(mapped["longitude"], errors="coerce")

if search_text.strip():
    term = search_text.strip().lower()
    filtered = mapped[
        mapped["name"].str.lower().str.contains(term, na=False)
        | mapped["street_address"].str.lower().str.contains(term, na=False)
        | mapped["category"].str.lower().str.contains(term, na=False)
    ]
else:
    filtered = mapped

col_map, col_directory = st.columns([1.75, 1], gap="large")

with col_map:
    st.subheader("Interactive map")
    map_data = filtered.dropna(subset=["latitude", "longitude"])
    if not map_data.empty:
        map_object = build_map(map_data)
        st_folium(
            map_object,
            width=None,
            height=690,
            returned_objects=[],
            use_container_width=True,
            key="niagara_services_map",
        )
    else:
        st.warning("No mapped locations match your search.")

    mapped_count = int(mapped["latitude"].notna().sum())
    st.caption(f"{mapped_count} of {len(locations)} locations successfully mapped.")

with col_directory:
    st.subheader(f"Location directory ({len(filtered)})")
    st.caption("Numbers correspond to the numbered pins on the map.")

    for row in filtered.itertuples(index=False):
        color = COLORS[(int(row.id) - 1) % len(COLORS)]
        phone_line = (
            f'<div class="location-detail">☎ {html.escape(str(row.phone))}</div>'
            if show_phone and row.phone else ""
        )
        address = html.escape(str(row.full_address))
        name = html.escape(str(row.name))
        category = html.escape(str(row.category))

        st.markdown(
            f"""
            <div class="location-card">
              <div class="location-name">
                <span class="pin-number" style="background:{color};">{row.id}</span>{name}
              </div>
              <div class="location-detail">📍 {address}</div>
              <div class="location-detail"> {category}</div>
              {phone_line}
            </div>
            """,
            unsafe_allow_html=True,
        )

with st.expander("Address matching details"):
    st.write(
        "The street addresses and organization names were transcribed from the "
        "reference image. The geocoder's matched address is shown below so you "
        "can review whether each result points to the intended location."
    )
    review = mapped[["id", "name", "full_address", "matched_address", "latitude", "longitude"]]
    st.dataframe(review, use_container_width=True, hide_index=True)

st.caption(
    "Map data © OpenStreetMap contributors. Addresses are based on the supplied "
    "reference image; verify locations and service details before relying on them."
)
