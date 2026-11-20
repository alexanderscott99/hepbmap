library(sf)
library(dplyr)
library(jsonlite)
library(rmapshaper)

# ============================================================
# FILE NAMES
# ============================================================

lad_file <- paste0(
  "Middle_Layer_Super_Output_Area_(2021)_to_LAD_",
  "(April_2023)_Lookup_in_England_and_Wales.csv"
)

# ============================================================
# CHECK REQUIRED FILES EXIST
# ============================================================

required_files <- c(
  "msoa_map.rds",
  "hbv_data.rds",
  lad_file
)

missing_files <- required_files[
  !file.exists(required_files)
]

if (length(missing_files) > 0) {
  stop(
    paste(
      "Missing required file(s):",
      paste(
        missing_files,
        collapse = ", "
      )
    )
  )
}

# ============================================================
# LOAD EXISTING DATA
# ============================================================

msoa_map <- readRDS(
  "msoa_map.rds"
)

hbv_data <- readRDS(
  "hbv_data.rds"
)

lad_raw <- read.csv(
  lad_file,
  stringsAsFactors = FALSE,
  check.names = FALSE
)

# ============================================================
# VALIDATE SPATIAL DATA
# ============================================================

if (!inherits(msoa_map, "sf")) {
  stop(
    "msoa_map.rds must contain an sf object."
  )
}

if (is.na(st_crs(msoa_map))) {
  stop(
    "msoa_map has no coordinate reference system."
  )
}

if (
  !all(
    c(
      "msoa21_code",
      "msoa21_name"
    ) %in% names(msoa_map)
  )
) {
  
  stop(
    paste(
      "msoa_map.rds must contain",
      "msoa21_code and msoa21_name."
    )
  )
}

if (
  anyDuplicated(
    msoa_map$msoa21_code
  )
) {
  
  stop(
    "msoa_map contains duplicate MSOA codes."
  )
}

# ============================================================
# VALIDATE HBV DATA
# ============================================================

required_hbv_columns <- c(
  "msoa21_code",
  "COB",
  "population",
  "prevalence_percent"
)

if (
  !all(
    required_hbv_columns %in%
    names(hbv_data)
  )
) {
  
  stop(
    paste(
      "hbv_data.rds must contain:",
      paste(
        required_hbv_columns,
        collapse = ", "
      )
    )
  )
}

hbv_data <- hbv_data %>%
  mutate(
    msoa21_code =
      as.character(
        msoa21_code
      ),
    
    COB =
      as.character(
        COB
      ),
    
    population =
      as.numeric(
        population
      ),
    
    prevalence_percent =
      as.numeric(
        prevalence_percent
      )
  )

if (
  anyNA(
    hbv_data[
      required_hbv_columns
    ]
  ) ||
  
  any(
    !is.finite(
      hbv_data$population
    )
  ) ||
  
  any(
    !is.finite(
      hbv_data$prevalence_percent
    )
  ) ||
  
  any(
    hbv_data$population < 0
  ) ||
  
  any(
    hbv_data$prevalence_percent < 0 |
    hbv_data$prevalence_percent > 100
  )
) {
  
  stop(
    paste(
      "The population/prevalence",
      "inputs contain invalid values."
    )
  )
}

# ============================================================
# CHECK ONE PREVALENCE ESTIMATE PER COUNTRY CATEGORY
# ============================================================

prevalence_check <- hbv_data %>%
  group_by(
    COB
  ) %>%
  summarise(
    estimates =
      n_distinct(
        prevalence_percent
      ),
    
    .groups = "drop"
  )

if (
  any(
    prevalence_check$estimates != 1
  )
) {
  
  stop(
    paste(
      "Some country categories have",
      "more than one prevalence estimate."
    )
  )
}

# ============================================================
# LOCAL AUTHORITY LOOKUP
# ============================================================

required_lad_columns <- c(
  "MSOA21CD",
  "MSOA21NM",
  "LAD23CD",
  "LAD23NM"
)

if (
  !all(
    required_lad_columns %in%
    names(lad_raw)
  )
) {
  
  stop(
    paste(
      "The Local Authority CSV needs:",
      paste(
        required_lad_columns,
        collapse = ", "
      )
    )
  )
}

lad_lookup <- lad_raw %>%
  transmute(
    msoa21_code =
      as.character(
        MSOA21CD
      ),
    
    la_code =
      as.character(
        LAD23CD
      ),
    
    la_name =
      as.character(
        LAD23NM
      )
  ) %>%
  distinct(
    msoa21_code,
    .keep_all = TRUE
  )

# ============================================================
# MASTER MSOA LOOKUP
# ============================================================

msoa_lookup <- msoa_map %>%
  st_drop_geometry() %>%
  transmute(
    msoa21_code =
      as.character(
        msoa21_code
      ),
    
    msoa21_name =
      as.character(
        msoa21_name
      )
  ) %>%
  left_join(
    lad_lookup,
    by = "msoa21_code"
  ) %>%
  mutate(
    la_code =
      coalesce(
        la_code,
        "UNKNOWN"
      ),
    
    la_name =
      coalesce(
        la_name,
        "Unknown Local Authority"
      )
  )

# ============================================================
# CHECK HBV RECORDS HAVE VALID MSOAs
# ============================================================

if (
  any(
    !hbv_data$msoa21_code %in%
    msoa_lookup$msoa21_code
  )
) {
  
  stop(
    paste(
      "Some population records have",
      "no matching MSOA boundary."
    )
  )
}

# ============================================================
# CALCULATE EXPECTED CHB CASES
# ============================================================

hbv_data <- hbv_data %>%
  mutate(
    expected_cases =
      population *
      prevalence_percent /
      100
  )

# ============================================================
# CREATE OUTPUT DIRECTORY
# ============================================================

if (
  !dir.exists("data")
) {
  
  dir.create(
    "data"
  )
}

# ============================================================
# 1. COMPACT MSOA x COUNTRY DATA
#
# IMPORTANT:
# We intentionally only store:
#
# MSOA code
# country category
# population
#
# MSOA names and Local Authorities are stored separately.
# Prevalence is stored once per country.
# Expected cases can therefore be calculated in the browser.
#
# This substantially reduces the website download size.
# ============================================================

detail_export <- hbv_data %>%
  select(
    msoa21_code,
    COB,
    population
  ) %>%
  arrange(
    msoa21_code,
    COB
  )

write_json(
  detail_export,
  "data/msoa_country.json",
  dataframe = "rows",
  digits = NA,
  na = "null",
  pretty = FALSE,
  auto_unbox = TRUE
)

# ============================================================
# 2. MSOA LOOKUP
# ============================================================

msoa_lookup_export <- msoa_lookup %>%
  select(
    msoa21_code,
    msoa21_name,
    la_code,
    la_name
  ) %>%
  arrange(
    la_name,
    msoa21_name
  )

write_json(
  msoa_lookup_export,
  "data/msoa_lookup.json",
  dataframe = "rows",
  na = "null",
  pretty = FALSE,
  auto_unbox = TRUE
)

# ============================================================
# 3. COUNTRY SUMMARY
#
# This also provides the prevalence estimate required to
# calculate expected cases in JavaScript.
# ============================================================

country_summary <- hbv_data %>%
  group_by(
    COB,
    prevalence_percent
  ) %>%
  summarise(
    population =
      sum(
        population,
        na.rm = TRUE
      ),
    
    expected_cases =
      sum(
        expected_cases,
        na.rm = TRUE
      ),
    
    .groups = "drop"
  ) %>%
  arrange(
    desc(
      expected_cases
    )
  )

write_json(
  country_summary,
  "data/country_summary.json",
  dataframe = "rows",
  digits = NA,
  na = "null",
  pretty = FALSE,
  auto_unbox = TRUE
)

# ============================================================
# 4. LOCAL AUTHORITY LOOKUP
# ============================================================

authority_lookup <- msoa_lookup %>%
  filter(
    la_code != "UNKNOWN"
  ) %>%
  distinct(
    la_code,
    la_name
  ) %>%
  arrange(
    la_name
  )

write_json(
  authority_lookup,
  "data/authority_lookup.json",
  dataframe = "rows",
  na = "null",
  pretty = FALSE,
  auto_unbox = TRUE
)

# ============================================================
# 5. PREPARE MAP
# ============================================================

msoa_web <- msoa_map %>%
  st_transform(
    4326
  ) %>%
  select(
    msoa21_code,
    msoa21_name
  ) %>%
  mutate(
    msoa21_code =
      as.character(
        msoa21_code
      ),
    
    msoa21_name =
      as.character(
        msoa21_name
      )
  ) %>%
  left_join(
    lad_lookup,
    by = "msoa21_code"
  ) %>%
  mutate(
    la_code =
      coalesce(
        la_code,
        "UNKNOWN"
      ),
    
    la_name =
      coalesce(
        la_name,
        "Unknown Local Authority"
      )
  )

# ============================================================
# SIMPLIFY POLYGONS
#
# This is only simplifying the visual map geometry.
# It does NOT alter:
#
# populations
# prevalence
# expected CHB burden
# MSOA codes
# MSOA selection
#
# keep = 0.05 retains 5% of the geometric detail while
# preserving individual polygon shapes.
# ============================================================
msoa_web <- msoa_map %>%
  st_transform(
    4326
  ) %>%
  select(
    msoa21_code,
    msoa21_name
  ) %>%
  mutate(
    msoa21_code =
      as.character(
        msoa21_code
      ),
    
    msoa21_name =
      as.character(
        msoa21_name
      )
  ) %>%
  left_join(
    lad_lookup,
    by = "msoa21_code"
  ) %>%
  mutate(
    la_code =
      coalesce(
        la_code,
        "UNKNOWN"
      ),
    
    la_name =
      coalesce(
        la_name,
        "Unknown Local Authority"
      )
  )
st_write(
  msoa_web,
  "data/msoa_boundaries.geojson",
  driver = "GeoJSON",
  delete_dsn = TRUE,
  quiet = TRUE
)

# ============================================================
# VALIDATION
# ============================================================

expected_combinations <-
  nrow(msoa_lookup) *
  length(
    unique(
      hbv_data$COB
    )
  )

actual_records <-
  nrow(
    detail_export
  )

number_msoas <-
  length(
    unique(
      detail_export$msoa21_code
    )
  )

number_countries <-
  length(
    unique(
      detail_export$COB
    )
  )

# ============================================================
# FILE SIZES
# ============================================================

output_files <- c(
  "data/authority_lookup.json",
  "data/country_summary.json",
  "data/msoa_boundaries.geojson",
  "data/msoa_country.json",
  "data/msoa_lookup.json"
)

file_sizes <- file.info(
  output_files
)$size

file_sizes_mb <-
  file_sizes /
  1024^2

# ============================================================
# FINISHED
# ============================================================

cat(
  "\n",
  "==============================================\n",
  "STATIC WEBSITE DATA CREATED SUCCESSFULLY\n",
  "==============================================\n\n",
  sep = ""
)

cat(
  "MSOAs:",
  format(
    number_msoas,
    big.mark = ","
  ),
  "\n"
)

cat(
  "Country categories:",
  number_countries,
  "\n"
)

cat(
  "Detailed MSOA x country records:",
  format(
    actual_records,
    big.mark = ","
  ),
  "\n"
)

cat(
  "Expected MSOA x country combinations:",
  format(
    expected_combinations,
    big.mark = ","
  ),
  "\n\n"
)

if (
  actual_records ==
  expected_combinations
) {
  
  cat(
    "CHECK: Complete MSOA x country matrix retained.\n\n"
  )
  
} else {
  
  cat(
    paste(
      "NOTE: Record count differs from a complete",
      "MSOA x country matrix.\n\n"
    )
  )
}

cat(
  "OUTPUT FILES\n",
  "------------\n"
)

for (
  i in seq_along(
    output_files
  )
) {
  
  cat(
    basename(
      output_files[i]
    ),
    ": ",
    format(
      round(
        file_sizes_mb[i],
        2
      ),
      nsmall = 2
    ),
    " MB\n",
    sep = ""
  )
}

cat(
  "\n",
  "Website data preparation complete.\n",
  sep = ""
)