
import html
import time
from io import BytesIO
from pathlib import Path

import folium
import pandas as pd
import qrcode
import streamlit as st
from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter
from streamlit_folium import st_folium


# ============================================================
# PAGE CONFIGURATION
# ============================================================

st.set_page_config(
    page_title="Niagara Falls Homeless Services Map",
    page_icon="📍",
    layout="wide"
)


# ============================================================
# FILE PATHS AND SETTINGS
# ============================================================

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"

LOCATIONS_FILE = DATA_DIR / "locations.csv"
CACHE_FILE = DATA_DIR / "geocoded_locations.csv"

CITY_SUFFIX = "Niagara Falls, NY, USA"

APP_URL = "https://niagragospelmap.streamlit.app/"

MAP_CENTER = [43.0962, -79.0377]
MAP_ZOOM = 14

COLORS = [
    "#C62828", "#EF6C00", "#7B1FA2", "#2E7D32",
    "#00838F", "#1565C0", "#558B2F", "#33691E",
    "#283593", "#0097A7", "#F57C00", "#6A1B9A",
    "#0D47A1", "#2E7D32", "#8E24AA", "#558B2F"
]


# ============================================================
# QR CODE
# ============================================================

def create_qr_code():

    qr = qrcode.QRCode(
        version=1,
        box_size=10,
        border=4
    )

    qr.add_data(APP_URL)
    qr.make(fit=True)

    image = qr.make_image(
        fill_color="black",
        back_color="white"
    )

    buffer = BytesIO()
    image.save(buffer, format="PNG")

    return buffer.getvalue()


qr_image = create_qr_code()


# ============================================================
# LOAD ORGANIZATION DATA
# ============================================================

@st.cache_data
def load_locations():

    if not LOCATIONS_FILE.exists():
        st.error(
            "locations.csv was not found. "
            "Please place it inside the data folder."
        )
        st.stop()

    data = pd.read_csv(LOCATIONS_FILE)

    required_columns = [
        "id",
        "name",
        "street_address",
        "category"
    ]

    missing_columns = [
        column for column in required_columns
        if column not in data.columns
    ]

    if missing_columns:
        st.error(
            f"Missing columns in locations.csv: {missing_columns}"
        )
        st.stop()

    if "phone" not in data.columns:
        data["phone"] = ""

    data = data.fillna("")

    data["id"] = pd.to_numeric(
        data["id"], errors="coerce"
    )

    if data["id"].isna().any():
        st.error("Every organization must have a valid numeric ID.")
        st.stop()

    data["id"] = data["id"].astype(int)

    if data["id"].duplicated().any():
        st.error("Duplicate organization IDs found in locations.csv.")
        st.stop()

    data["full_address"] = (
        data["street_address"].astype(str).str.strip()
        + ", "
        + CITY_SUFFIX
    )

    return data


# ============================================================
# GEOCODING CACHE
# ============================================================

def load_geocode_cache():

    columns = [
        "id",
        "latitude",
        "longitude",
        "matched_address"
    ]

    if not CACHE_FILE.exists():
        return pd.DataFrame(columns=columns)

    try:

        cache = pd.read_csv(CACHE_FILE)

        if not {"id", "latitude", "longitude"}.issubset(
            cache.columns
        ):
            return pd.DataFrame(columns=columns)

        if "matched_address" not in cache.columns:
            cache["matched_address"] = ""

        cache["id"] = pd.to_numeric(
            cache["id"], errors="coerce"
        )

        cache["latitude"] = pd.to_numeric(
            cache["latitude"], errors="coerce"
        )

        cache["longitude"] = pd.to_numeric(
            cache["longitude"], errors="coerce"
        )

        cache = cache.dropna(subset=["id"])
        cache["id"] = cache["id"].astype(int)

        cache = cache.drop_duplicates(
            subset=["id"], keep="last"
        )

        return cache[columns]

    except Exception as error:

        st.warning(
            f"Could not read geocoding cache: {error}"
        )

        return pd.DataFrame(columns=columns)


def save_geocode_cache(cache):

    DATA_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    cache.to_csv(
        CACHE_FILE,
        index=False
    )


# ============================================================
# ADDRESS GEOCODING
# ============================================================

def geocode_locations(
    data,
    retry_failed=False,
    force_all=False
):

    cache = load_geocode_cache()

    # Re-geocode everything if requested.
    if force_all:

        cache = pd.DataFrame(
            columns=[
                "id",
                "latitude",
                "longitude",
                "matched_address"
            ]
        )

    # Identify previously failed addresses.
    elif retry_failed:

        failed_mask = (
            cache["latitude"].isna()
            | cache["longitude"].isna()
        )

        failed_ids = set(
            cache.loc[
                failed_mask, "id"
            ].astype(int)
        )

        # Remove failed records so they can be retried.
        cache = cache[
            ~cache["id"].isin(failed_ids)
        ]

    # IDs already stored in the cache.
    known_ids = set(
        cache["id"].dropna().astype(int)
    )

    # Only process organizations without cached results.
    missing = data[
        ~data["id"].isin(known_ids)
    ].copy()

    if missing.empty:
        return cache

    # Initialize OpenStreetMap geocoder.
    geolocator = Nominatim(
        user_agent="niagara_falls_services_map_student_project"
    )

    geocode = RateLimiter(
        geolocator.geocode,
        min_delay_seconds=1.1,
        max_retries=2,
        error_wait_seconds=2.0,
        swallow_exceptions=True
    )

    progress = st.progress(
        0,
        text="Finding organization coordinates..."
    )

    new_rows = []

    total = len(missing)

    for index, row in enumerate(
        missing.itertuples(index=False),
        start=1
    ):

        result = None

        # Try several address formats.
        address_queries = [
            row.full_address,
            f"{row.street_address}, Niagara Falls, New York",
            f"{row.street_address}, Niagara Falls, NY, United States"
        ]

        for address in address_queries:

            if result is not None:
                break

            try:
                result = geocode(address)
            except Exception:
                result = None

        if result is not None:

            latitude = float(result.latitude)
            longitude = float(result.longitude)

            matched_address = result.address

        else:

            latitude = None
            longitude = None

            matched_address = (
                "Address not found - manual verification required"
            )

        new_rows.append({

            "id": int(row.id),

            "latitude": latitude,

            "longitude": longitude,

            "matched_address": matched_address

        })

        progress.progress(
            index / total,
            text=f"Processing address {index} of {total}..."
        )

    progress.empty()

    # Combine previous and new results.
    updated = pd.concat(
        [cache, pd.DataFrame(new_rows)],
        ignore_index=True
    )

    updated = updated.drop_duplicates(
        subset=["id"],
        keep="last"
    )

    save_geocode_cache(updated)

    return updated


# ============================================================
# MAP MARKER ICONS
# ============================================================

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
        ">
            {number}
        </div>
        """,

        icon_size=(31, 31),

        icon_anchor=(15, 15)

    )


# ============================================================
# BUILD INTERACTIVE MAP
# ============================================================

def build_map(mapped_data):

    map_object = folium.Map(

        location=MAP_CENTER,

        zoom_start=MAP_ZOOM,

        tiles="OpenStreetMap",

        control_scale=True

    )

    bounds = []

    for row in mapped_data.itertuples(index=False):

        if (
            pd.isna(row.latitude)
            or pd.isna(row.longitude)
        ):
            continue

        color = COLORS[
            (int(row.id) - 1) % len(COLORS)
        ]

        safe_name = html.escape(str(row.name))

        safe_address = html.escape(
            str(row.full_address)
        )

        safe_phone = (
            html.escape(str(row.phone))
            if row.phone
            else "Not listed"
        )

        safe_category = html.escape(
            str(row.category)
        )

        popup_html = f"""

        <div style="
            font-family:Arial;
            width:220px;
            line-height:1.5;
        ">

            <h4 style="margin:0 0 7px 0;">
                {row.id}. {safe_name}
            </h4>

            <div>
                <b>Address:</b> {safe_address}
            </div>

            <div>
                <b>Phone:</b> {safe_phone}
            </div>

            <div>
                <b>Services:</b> {safe_category}
            </div>

        </div>

        """

        folium.Marker(

            location=[
                row.latitude,
                row.longitude
            ],

            tooltip=f"{row.id}. {safe_name}",

            popup=folium.Popup(
                popup_html,
                max_width=300
            ),

            icon=make_numbered_icon(
                row.id,
                color
            )

        ).add_to(map_object)

        bounds.append([
            row.latitude,
            row.longitude
        ])

    # Automatically zoom to all visible pins.
    if bounds:

        if len(bounds) == 1:

            map_object.location = bounds[0]
            map_object.zoom_start = 16

        else:

            map_object.fit_bounds(
                bounds,
                padding=(25, 25)
            )

    return map_object


# ============================================================
# CUSTOM CSS
# ============================================================

st.markdown(

    """

    <style>

    .main-title {
        font-size:2rem;
        font-weight:800;
        color:#12345a;
        margin-bottom:0;
    }

    .sub-title {
        color:#64748b;
        margin-top:0.2rem;
    }

    .location-card {
        border:1px solid #d9e2ec;
        border-radius:10px;
        padding:10px 12px;
        margin-bottom:8px;
        background:var(--secondary-background-color);
    }

    .location-name {
        font-weight:700;
        font-size:0.94rem;
    }

    .location-detail {
        font-size:0.82rem;
        color:var(--text-color);
        margin-top:3px;
    }

    .pin-number {
        display:inline-flex;
        align-items:center;
        justify-content:center;
        width:25px;
        height:25px;
        border-radius:50%;
        color:white;
        font-weight:800;
        margin-right:7px;
        vertical-align:middle;
    }

    </style>

    """,

    unsafe_allow_html=True

)


# ============================================================
# PAGE HEADER
# ============================================================

st.markdown(

    '<div class="main-title">'
    'Niagara Falls Homeless Services Map'
    '</div>',

    unsafe_allow_html=True

)

st.markdown(

    '<div class="sub-title">'
    'Support • Resources • Hope | Niagara Falls, New York'
    '</div>',

    unsafe_allow_html=True

)

st.divider()


# ============================================================
# LOAD DATA
# ============================================================

locations = load_locations()


# ============================================================
# SIDEBAR CONTROLS
# ============================================================

with st.sidebar:

    st.header("Map controls")

    search_text = st.text_input(
        "Search organization or address"
    )

    show_phone = st.checkbox(
        "Show phone numbers",
        value=True
    )

    st.caption(
        "Map coordinates are looked up using "
        "OpenStreetMap's Nominatim service."
    )

    st.divider()

    retry_failed = st.button(
        "Retry failed addresses",
        use_container_width=True
    )

    force_all = st.button(
        "Re-geocode all addresses",
        use_container_width=True
    )

    st.divider()

    st.subheader("Access Map by QR Code")

    st.image(
        qr_image,
        caption="Scan to access Niagara Falls Services Map"
    )

    st.download_button(

        label="Download QR Code",

        data=qr_image,

        file_name="niagara_falls_services_qr.png",

        mime="image/png",

        use_container_width=True

    )


# ============================================================
# GEOCODE LOCATIONS
# ============================================================

with st.spinner("Loading map locations..."):

    geo_cache = geocode_locations(

        locations,

        retry_failed=retry_failed,

        force_all=force_all

    )


# ============================================================
# MERGE ORGANIZATIONS WITH COORDINATES
# ============================================================

mapped = locations.merge(

    geo_cache,

    on="id",

    how="left"

)

mapped["latitude"] = pd.to_numeric(
    mapped["latitude"],
    errors="coerce"
)

mapped["longitude"] = pd.to_numeric(
    mapped["longitude"],
    errors="coerce"
)


# ============================================================
# SEARCH FILTER
# ============================================================

if search_text.strip():

    term = search_text.strip().lower()

    filtered = mapped[

        mapped["name"].astype(str).str.lower().str.contains(
            term,
            na=False,
            regex=False
        )

        |

        mapped["street_address"].astype(str).str.lower().str.contains(
            term,
            na=False,
            regex=False
        )

        |

        mapped["category"].astype(str).str.lower().str.contains(
            term,
            na=False,
            regex=False
        )

    ].copy()

else:

    filtered = mapped.copy()


# ============================================================
# SUMMARY METRICS
# ============================================================

total_count = len(locations)

mapped_count = int(
    mapped["latitude"].notna().sum()
    & mapped["longitude"].notna().sum()
)

unmapped_count = total_count - mapped_count

col1, col2, col3 = st.columns(3)

col1.metric(
    "Total Organizations",
    total_count
)

col2.metric(
    "Successfully Mapped",
    mapped_count
)

col3.metric(
    "Missing Coordinates",
    unmapped_count
)

st.divider()


# ============================================================
# MAP AND DIRECTORY LAYOUT
# ============================================================

col_map, col_directory = st.columns(
    [1.75, 1],
    gap="large"
)


# ============================================================
# INTERACTIVE MAP
# ============================================================

with col_map:

    st.subheader("Interactive map")

    map_data = filtered.dropna(
        subset=["latitude", "longitude"]
    )

    if not map_data.empty:

        map_object = build_map(map_data)

        st_folium(

            map_object,

            width=None,

            height=690,

            returned_objects=[],

            use_container_width=True,

            key="niagara_services_map"

        )

    else:

        st.warning(
            "No mapped locations match your search."
        )

    st.caption(
        f"{len(map_data)} of {len(filtered)} "
        "matching organizations are displayed on the map."
    )


# ============================================================
# ORGANIZATION DIRECTORY
# ============================================================

with col_directory:

    st.subheader(
        f"Location directory ({len(filtered)})"
    )

    st.caption(
        "Numbers correspond to the numbered pins on the map."
    )

    for row in filtered.itertuples(index=False):

        color = COLORS[
            (int(row.id) - 1) % len(COLORS)
        ]

        phone_line = (

            f'<div class="location-detail">'
            f'☎ {html.escape(str(row.phone))}'
            f'</div>'

            if show_phone and row.phone

            else ""

        )

        address = html.escape(
            str(row.full_address)
        )

        name = html.escape(
            str(row.name)
        )

        category = html.escape(
            str(row.category)
        )

        if pd.notna(row.latitude) and pd.notna(row.longitude):

            map_status = (
                '<span style="color:green;">'
                '● Mapped'
                '</span>'
            )

        else:

            map_status = (
                '<span style="color:#d97706;">'
                '● Location needs verification'
                '</span>'
            )

        st.markdown(

            f"""

            <div class="location-card">

                <div class="location-name">

                    <span class="pin-number"
                    style="background:{color};">

                        {row.id}

                    </span>

                    {name}

                </div>

                <div class="location-detail">
                    📍 {address}
                </div>

                <div class="location-detail">
                    {category}
                </div>

                <div class="location-detail">
                    {map_status}
                </div>

                {phone_line}

            </div>

            """,

            unsafe_allow_html=True

        )


# ============================================================
# ADDRESS MATCHING DETAILS
# ============================================================

with st.expander("Address matching details"):

    st.write(

        "Review the geocoder's matched address to "
        "confirm that each pin points to the correct organization."

    )

    review = mapped[

        [
            "id",
            "name",
            "full_address",
            "matched_address",
            "latitude",
            "longitude"
        ]

    ]

    st.dataframe(

        review,

        use_container_width=True,

        hide_index=True

    )

    failed = mapped[
        mapped["latitude"].isna()
        | mapped["longitude"].isna()
    ]

    if not failed.empty:

        st.warning(
            f"{len(failed)} organizations still need "
            "coordinate verification."
        )

        st.dataframe(

            failed[
                [
                    "id",
                    "name",
                    "street_address"
                ]
            ],

            use_container_width=True,

            hide_index=True

        )


# ============================================================
# FOOTER
# ============================================================

st.divider()

st.caption(

    "Map data © OpenStreetMap contributors. "
    "Addresses are based on the supplied reference data. "
    "Please verify locations and service details before relying on them."

)
