    "use strict";
    
    /* ============================================================
       ESTIMATED BURDEN OF CHRONIC HEPATITIS B
       Static website application
       ============================================================ */
    
    
    /* ============================================================
       GLOBAL STATE
       ============================================================ */
    
    const state = {
      authorityLookup: [],
      countrySummary: [],
      msoaLookup: [],
      detail: [],
      geojson: null,
    
      msoaByCode: new Map(),
      prevalenceByCountry: new Map(),
      recordsByMsoa: new Map(),
      recordsByCountry: new Map(),
    
      selectedCountries: new Set(),
      selectedAuthorities: new Set(["__ALL__"]),
      selectedMsoas: new Set(),
    
      allAreasSelected: true,
      selectedMsoaCode: null,
    
      map: null,
      geoLayer: null,
      legend: null,
      authoritySelect: null,
    
      currentSummary: [],
      nationalSummary: [],
    
      tables: {},
      dataLoaded: false
    };
    
    
    /* ============================================================
       ELEMENT HELPERS
       ============================================================ */
    
    function byId(id) {
      return document.getElementById(id);
    }
    
    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }
    
    
    /* ============================================================
       NUMBER FORMATTING
       ============================================================ */
    
    function formatNumber(value) {
      const number = Number(value);
    
      if (!Number.isFinite(number)) {
        return "";
      }
    
      return new Intl.NumberFormat("en-GB", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }).format(number);
    }
    
    function formatInteger(value) {
      const number = Number(value);
    
      if (!Number.isFinite(number)) {
        return "";
      }
    
      return new Intl.NumberFormat("en-GB", {
        maximumFractionDigits: 0
      }).format(number);
    }
    
    
    /* ============================================================
       LOADING AND ERROR MESSAGES
       ============================================================ */
    
    function setLoadingMessage(message) {
      const element = byId("loading-message");
    
      if (element) {
        element.textContent = message;
      }
    }
    
    function hideLoadingScreen() {
      byId("loading-screen")?.classList.add("hidden");
    }
    
    function showMapLoading() {
      byId("map-loading")?.classList.add("visible");
    }
    
    function hideMapLoading() {
      byId("map-loading")?.classList.remove("visible");
    }
    
    function showFatalError(error) {
      console.error(error);
    
      const loadingScreen = byId("loading-screen");
    
      if (!loadingScreen) {
        return;
      }
    
      loadingScreen.innerHTML = `
        <div class="error-box">
          <h2>The website could not load</h2>
    
          <p>
            ${escapeHtml(error?.message || String(error))}
          </p>
    
          <p>
            Check that the five required files are present inside the
            <strong>data</strong> folder and that the website is being
            opened through a web server.
          </p>
        </div>
      `;
    }
    
    
    /* ============================================================
       DATA LOADING
       ============================================================ */
    
    async function fetchJson(path) {
      let response;
    
      try {
        response = await fetch(path, {
          cache: "no-cache"
        });
      } catch (error) {
        throw new Error(
          `Failed to fetch ${path}. Check that the file exists and is accessible.`
        );
      }
    
      if (!response.ok) {
        throw new Error(
          `Could not load ${path}. HTTP status ${response.status}.`
        );
      }
    
      try {
        return await response.json();
      } catch (error) {
        throw new Error(
          `The file ${path} could not be parsed as valid JSON.`
        );
      }
    }
    
    async function loadData() {
      setLoadingMessage(
        "Loading Local Authority, country and MSOA lookups..."
      );
    
      const [
        authorityLookup,
        countrySummary,
        msoaLookup
      ] = await Promise.all([
        fetchJson("data/authority_lookup.json"),
        fetchJson("data/country_summary.json"),
        fetchJson("data/msoa_lookup.json")
      ]);
    
      if (!Array.isArray(authorityLookup)) {
        throw new Error(
          "authority_lookup.json does not contain a valid array."
        );
      }
    
      if (!Array.isArray(countrySummary)) {
        throw new Error(
          "country_summary.json does not contain a valid array."
        );
      }
    
      if (!Array.isArray(msoaLookup)) {
        throw new Error(
          "msoa_lookup.json does not contain a valid array."
        );
      }
    
      state.authorityLookup = authorityLookup;
      state.countrySummary = countrySummary;
      state.msoaLookup = msoaLookup;
    
      setLoadingMessage(
        "Loading compact MSOA population matrix..."
      );
    
      const matrixData = await fetchJson(
        "data/msoa_country_matrix.json"
      );
    
      if (
        !matrixData ||
        !Array.isArray(matrixData.countries) ||
        !Array.isArray(matrixData.rows)
      ) {
        throw new Error(
          "msoa_country_matrix.json has an invalid structure."
        );
      }
    
      const matrixCountries = matrixData.countries.map(
        country => String(country)
      );
    
      const countrySummaryNames = new Set(
        state.countrySummary.map(
          row => String(row.COB)
        )
      );
    
      const missingCountries = matrixCountries.filter(
        country => !countrySummaryNames.has(country)
      );
    
      if (missingCountries.length > 0) {
        throw new Error(
          "The matrix contains country categories that are missing " +
          "from country_summary.json."
        );
      }
    
      const expectedRowLength =
        matrixCountries.length + 1;
    
      state.detail = [];
    
      for (let rowIndex = 0; rowIndex < matrixData.rows.length; rowIndex += 1) {
        const matrixRow = matrixData.rows[rowIndex];
    
        if (
          !Array.isArray(matrixRow) ||
          matrixRow.length !== expectedRowLength
        ) {
          throw new Error(
            `Matrix row ${rowIndex + 1} has an invalid length.`
          );
        }
    
        const msoaCode = String(matrixRow[0]);
    
        for (
          let countryIndex = 0;
          countryIndex < matrixCountries.length;
          countryIndex += 1
        ) {
          const rawPopulation =
            matrixRow[countryIndex + 1];
    
          const population =
            Number(rawPopulation);
    
          if (
            !Number.isFinite(population) ||
            population < 0
          ) {
            throw new Error(
              `Invalid population value in matrix row ${rowIndex + 1}.`
            );
          }
    
          state.detail.push({
            msoa21_code: msoaCode,
            COB: matrixCountries[countryIndex],
            population
          });
        }
      }
    
      setLoadingMessage(
        "Loading MSOA boundaries..."
      );
    
      state.geojson = await fetchJson(
        "data/msoa_boundaries.geojson"
      );
    
      if (
        !state.geojson ||
        state.geojson.type !== "FeatureCollection" ||
        !Array.isArray(state.geojson.features)
      ) {
        throw new Error(
          "msoa_boundaries.geojson is not a valid GeoJSON FeatureCollection."
        );
      }
    
      state.dataLoaded = true;
    }
    
    
    /* ============================================================
       BUILD LOOKUPS AND INDICES
       ============================================================ */
    
    function buildIndices() {
      state.msoaByCode.clear();
      state.prevalenceByCountry.clear();
      state.recordsByMsoa.clear();
      state.recordsByCountry.clear();
      state.selectedCountries.clear();
    
      for (const row of state.msoaLookup) {
        state.msoaByCode.set(
          String(row.msoa21_code),
          row
        );
      }
    
      for (const row of state.countrySummary) {
        const country = String(row.COB);
        const prevalence =
          Number(row.prevalence_percent);
    
        state.prevalenceByCountry.set(
          country,
          Number.isFinite(prevalence)
            ? prevalence
            : 0
        );
    
        state.selectedCountries.add(country);
      }
    
      for (const row of state.detail) {
        const record = {
          code: String(row.msoa21_code),
          country: String(row.COB),
          population: Number(row.population) || 0
        };
    
        if (!state.recordsByMsoa.has(record.code)) {
          state.recordsByMsoa.set(
            record.code,
            []
          );
        }
    
        state.recordsByMsoa
          .get(record.code)
          .push(record);
    
        if (!state.recordsByCountry.has(record.country)) {
          state.recordsByCountry.set(
            record.country,
            []
          );
        }
    
        state.recordsByCountry
          .get(record.country)
          .push(record);
      }
    }
    
    
    /* ============================================================
       TAB NAVIGATION
       ============================================================ */
    
    function openMainTab(tabId) {
      document.querySelectorAll(".tab-button").forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset.tab === tabId
        );
      });
    
      document.querySelectorAll(".tab-panel").forEach(panel => {
        panel.classList.toggle(
          "active",
          panel.id === tabId
        );
      });
    
      if (tabId === "map-tab" && state.map) {
        window.setTimeout(() => {
          state.map.invalidateSize();
        }, 100);
      }
    
      if (tabId === "hotspots") {
        renderHotspotTable();
      }
    
      if (tabId === "country-profiles") {
        renderCountryProfile();
      }
    
      if (tabId === "local-authorities") {
        renderAuthorityTables();
      }
    
      if (tabId === "data-tab") {
        renderMainDataTables();
      }
    }
    
    function initialiseNavigation() {
      document.querySelectorAll(".tab-button").forEach(button => {
        button.addEventListener("click", () => {
          openMainTab(
            button.dataset.tab
          );
        });
      });
    
      document.querySelectorAll("[data-open-tab]").forEach(button => {
        button.addEventListener("click", () => {
          openMainTab(
            button.dataset.openTab
          );
        });
      });
    
      document.querySelectorAll(".sub-tab-button").forEach(button => {
        button.addEventListener("click", () => {
          const subtabId =
            button.dataset.subtab;
    
          document.querySelectorAll(".sub-tab-button").forEach(item => {
            item.classList.toggle(
              "active",
              item.dataset.subtab === subtabId
            );
          });
    
          document.querySelectorAll(".sub-tab-panel").forEach(panel => {
            panel.classList.toggle(
              "active",
              panel.id === subtabId
            );
          });
    
          if (subtabId === "detail-data") {
            renderDetailTable();
          }
        });
      });
    }
    
    
    /* ============================================================
       OVERVIEW
       ============================================================ */
    
    function renderOverview() {
      const totalPopulation = state.countrySummary.reduce(
        (total, row) =>
          total + Number(row.population || 0),
        0
      );
    
      const totalCases = state.countrySummary.reduce(
        (total, row) =>
          total + Number(row.expected_cases || 0),
        0
      );
    
      byId("overview-cases").textContent =
        formatNumber(totalCases);
    
      byId("overview-population").textContent =
        formatNumber(totalPopulation);
    
      byId("overview-msoas").textContent =
        formatInteger(state.msoaLookup.length);
    
      byId("overview-countries-count").textContent =
        formatInteger(state.countrySummary.length);
    
      const tableBody = document.querySelector(
        "#overview-country-table tbody"
      );
    
      tableBody.innerHTML = "";
    
      state.countrySummary
        .slice()
        .sort(
          (a, b) =>
            Number(b.expected_cases) -
            Number(a.expected_cases)
        )
        .slice(0, 10)
        .forEach(row => {
          const tableRow =
            document.createElement("tr");
    
          tableRow.innerHTML = `
            <td>${escapeHtml(row.COB)}</td>
    
            <td class="numeric">
              ${formatNumber(row.population)}
            </td>
    
            <td class="numeric">
              ${formatNumber(row.prevalence_percent)}
            </td>
    
            <td class="numeric">
              ${formatNumber(row.expected_cases)}
            </td>
          `;
    
          tableBody.appendChild(tableRow);
        });
    }
    
    
    /* ============================================================
       LOCAL AUTHORITY MULTI-SELECT
       ============================================================ */
    
    function initialiseAuthoritySelector() {
      const element =
        byId("authority-select");
    
      element.innerHTML = "";
    
      const allOption =
        document.createElement("option");
    
      allOption.value = "__ALL__";
      allOption.textContent =
        "All England and Wales";
    
      allOption.selected = true;
    
      element.appendChild(allOption);
    
      for (const authority of state.authorityLookup) {
        const option =
          document.createElement("option");
    
        option.value = authority.la_code;
        option.textContent = authority.la_name;
    
        element.appendChild(option);
      }
    
      state.authoritySelect = new TomSelect(
        element,
        {
          plugins: ["remove_button"],
          maxOptions: null,
          closeAfterSelect: false,
          placeholder:
            "Select one or more Local Authorities",
    
          onChange(values) {
            const selected = Array.isArray(values)
              ? values
              : values
                ? [values]
                : [];
    
            if (selected.includes("__ALL__")) {
              state.selectedAuthorities =
                new Set(["__ALL__"]);
    
              state.allAreasSelected = true;
              state.selectedMsoas.clear();
            } else {
              state.selectedAuthorities =
                new Set(selected);
    
              state.allAreasSelected = false;
    
              const validCodes =
                getMsoasForSelectedAuthorities()
                  .map(row => row.msoa21_code);
    
              state.selectedMsoas =
                new Set(validCodes);
            }
    
            renderMsoaCheckboxes();
            updateAllOutputs();
          }
        }
      );
    }
    
    function getMsoasForSelectedAuthorities() {
      if (
        state.selectedAuthorities.has("__ALL__")
      ) {
        return [];
      }
    
      return state.msoaLookup
        .filter(row =>
          state.selectedAuthorities.has(
            row.la_code
          )
        )
        .sort((a, b) => {
          const authorityComparison =
            a.la_name.localeCompare(
              b.la_name
            );
    
          if (authorityComparison !== 0) {
            return authorityComparison;
          }
    
          return a.msoa21_name.localeCompare(
            b.msoa21_name
          );
        });
    }
    
    
    /* ============================================================
       MSOA CHECKBOXES
       ============================================================ */
    
    function renderMsoaCheckboxes() {
      const container =
        byId("msoa-checkbox-list");
    
      const summary =
        byId("msoa-selection-summary");
    
      container.innerHTML = "";
    
      if (
        state.selectedAuthorities.has("__ALL__")
      ) {
        summary.textContent =
          `${formatInteger(state.msoaLookup.length)} MSOAs included`;
    
        container.innerHTML = `
          <p class="help-text">
            All MSOAs in England and Wales are displayed.
            Remove “All England and Wales” from the selector to choose
            individual Local Authorities and MSOAs.
          </p>
        `;
    
        return;
      }
    
      const availableMsoas =
        getMsoasForSelectedAuthorities();
    
      if (availableMsoas.length === 0) {
        summary.textContent =
          "No Local Authorities selected.";
    
        container.innerHTML = `
          <p class="help-text">
            Select one or more Local Authorities above.
          </p>
        `;
    
        return;
      }
    
      summary.textContent =
        `${formatInteger(state.selectedMsoas.size)} of ` +
        `${formatInteger(availableMsoas.length)} MSOAs selected`;
    
      const fragment =
        document.createDocumentFragment();
    
      for (const area of availableMsoas) {
        const wrapper =
          document.createElement("div");
    
        wrapper.className =
          "checkbox-item";
    
        const checkbox =
          document.createElement("input");
    
        checkbox.type = "checkbox";
        checkbox.id =
          `msoa-${area.msoa21_code}`;
    
        checkbox.value =
          area.msoa21_code;
    
        checkbox.checked =
          state.selectedMsoas.has(
            area.msoa21_code
          );
    
        const label =
          document.createElement("label");
    
        label.htmlFor = checkbox.id;
    
        label.textContent =
          `${area.la_name} | ` +
          `${area.msoa21_name} | ` +
          `${area.msoa21_code}`;
    
        checkbox.addEventListener(
          "change",
          () => {
            if (checkbox.checked) {
              state.selectedMsoas.add(
                area.msoa21_code
              );
            } else {
              state.selectedMsoas.delete(
                area.msoa21_code
              );
            }
    
            summary.textContent =
              `${formatInteger(state.selectedMsoas.size)} of ` +
              `${formatInteger(availableMsoas.length)} MSOAs selected`;
    
            updateAllOutputs();
          }
        );
    
        wrapper.appendChild(checkbox);
        wrapper.appendChild(label);
        fragment.appendChild(wrapper);
      }
    
      container.appendChild(fragment);
    }
    
    function initialiseMsoaButtons() {
      byId("select-all-msoas").addEventListener(
        "click",
        () => {
          if (
            state.selectedAuthorities.has("__ALL__")
          ) {
            state.allAreasSelected = true;
          } else {
            state.selectedMsoas = new Set(
              getMsoasForSelectedAuthorities()
                .map(row => row.msoa21_code)
            );
          }
    
          renderMsoaCheckboxes();
          updateAllOutputs();
        }
      );
    
      byId("clear-all-msoas").addEventListener(
        "click",
        () => {
          state.allAreasSelected = false;
          state.selectedMsoas.clear();
    
          if (
            state.selectedAuthorities.has("__ALL__")
          ) {
            state.selectedAuthorities.clear();
    
            state.authoritySelect.clear(true);
          }
    
          renderMsoaCheckboxes();
          updateAllOutputs();
        }
      );
    }
    
    
    /* ============================================================
       COUNTRY CHECKBOXES
       ============================================================ */
    
    function renderCountryCheckboxes() {
      const container =
        byId("country-checkbox-list");
    
      container.innerHTML = "";
    
      const countries = state.countrySummary
        .slice()
        .sort((a, b) =>
          String(a.COB).localeCompare(
            String(b.COB)
          )
        );
    
      const fragment =
        document.createDocumentFragment();
    
      for (const country of countries) {
        const wrapper =
          document.createElement("div");
    
        wrapper.className =
          "checkbox-item";
    
        const checkbox =
          document.createElement("input");
    
        checkbox.type = "checkbox";
    
        checkbox.id =
          `country-${String(country.COB)
            .replaceAll(
              /[^a-zA-Z0-9]/g,
              "-"
            )}`;
    
        checkbox.value =
          country.COB;
    
        checkbox.checked =
          state.selectedCountries.has(
            country.COB
          );
    
        const label =
          document.createElement("label");
    
        label.htmlFor = checkbox.id;
        label.textContent = country.COB;
    
        checkbox.addEventListener(
          "change",
          () => {
            if (checkbox.checked) {
              state.selectedCountries.add(
                country.COB
              );
            } else {
              state.selectedCountries.delete(
                country.COB
              );
            }
    
            updateAllOutputs();
          }
        );
    
        wrapper.appendChild(checkbox);
        wrapper.appendChild(label);
        fragment.appendChild(wrapper);
      }
    
      container.appendChild(fragment);
    }
    
    function initialiseCountryButtons() {
      byId("select-all-countries").addEventListener(
        "click",
        () => {
          state.selectedCountries =
            new Set(
              state.countrySummary.map(
                row => row.COB
              )
            );
    
          renderCountryCheckboxes();
          updateAllOutputs();
        }
      );
    
      byId("clear-all-countries").addEventListener(
        "click",
        () => {
          state.selectedCountries.clear();
    
          renderCountryCheckboxes();
          updateAllOutputs();
        }
      );
    }
    
    
    /* ============================================================
       AGGREGATION
       ============================================================ */
    
    function calculateAreaSummary(
      code,
      countries
    ) {
      const records =
        state.recordsByMsoa.get(code) || [];
    
      let population = 0;
      let expectedCases = 0;
    
      const contributions = [];
    
      for (const record of records) {
        if (
          !countries.has(record.country)
        ) {
          continue;
        }
    
        const prevalence =
          state.prevalenceByCountry.get(
            record.country
          ) || 0;
    
        const cases =
          record.population *
          prevalence /
          100;
    
        population += record.population;
        expectedCases += cases;
    
        contributions.push({
          country: record.country,
          population: record.population,
          prevalence,
          expectedCases: cases
        });
      }
    
      return {
        population,
        expectedCases,
    
        casesPer1000:
          population > 0
            ? 1000 *
              expectedCases /
              population
            : null,
    
        contributions
      };
    }
    
    function calculateNationalSummary() {
      const results = [];
    
      for (const area of state.msoaLookup) {
        const summary =
          calculateAreaSummary(
            area.msoa21_code,
            state.selectedCountries
          );
    
        results.push({
          code: area.msoa21_code,
          name: area.msoa21_name,
          laCode: area.la_code,
          laName: area.la_name,
    
          population:
            summary.population,
    
          expectedCases:
            summary.expectedCases,
    
          casesPer1000:
            summary.casesPer1000,
    
          contributions:
            summary.contributions
        });
      }
    
      results.sort(
        (a, b) =>
          b.expectedCases -
            a.expectedCases ||
          a.code.localeCompare(b.code)
      );
    
      results.forEach((row, index) => {
        row.nationalRank = index + 1;
      });
    
      return results;
    }
    
    function areaIsGeographicallySelected(code) {
      if (
        state.selectedAuthorities.has("__ALL__") &&
        state.allAreasSelected
      ) {
        return true;
      }
    
      return state.selectedMsoas.has(code);
    }
    
    function calculateDisplayedSummary() {
      const threshold =
        Number(
          byId("threshold-select").value
        ) || 0;
    
      const topN =
        Number(
          byId("top-n-select").value
        ) || 0;
    
      let results =
        state.nationalSummary.filter(row =>
          areaIsGeographicallySelected(
            row.code
          ) &&
          row.expectedCases >= threshold
        );
    
      results.sort(
        (a, b) =>
          b.expectedCases -
            a.expectedCases ||
          a.code.localeCompare(b.code)
      );
    
      if (topN > 0) {
        results = results.slice(0, topN);
      }
    
      return results;
    }
    
    
    /* ============================================================
       COLOUR PALETTES
       ============================================================ */
    
    const palettes = {
      YlOrRd: [
        "#ffffcc",
        "#ffeda0",
        "#fed976",
        "#feb24c",
        "#fd8d3c",
        "#f03b20",
        "#bd0026"
      ],
    
      viridis: [
        "#440154",
        "#443983",
        "#31688e",
        "#21918c",
        "#35b779",
        "#90d743",
        "#fde725"
      ],
    
      magma: [
        "#000004",
        "#2c115f",
        "#721f81",
        "#b73779",
        "#f1605d",
        "#feb078",
        "#fcfdbf"
      ],
    
      Blues: [
        "#f7fbff",
        "#deebf7",
        "#c6dbef",
        "#9ecae1",
        "#6baed6",
        "#3182bd",
        "#08519c"
      ],
    
      Greens: [
        "#f7fcf5",
        "#e5f5e0",
        "#c7e9c0",
        "#a1d99b",
        "#74c476",
        "#31a354",
        "#006d2c"
      ],
    
      Purples: [
        "#fcfbfd",
        "#efedf5",
        "#dadaeb",
        "#bcbddc",
        "#9e9ac8",
        "#756bb1",
        "#54278f"
      ]
    };
    
    function getSelectedPalette() {
      let palette =
        palettes[
          byId("palette-select").value
        ] ||
        palettes.viridis;
    
      palette = palette.slice();
    
      if (
        byId("reverse-palette").checked
      ) {
        palette.reverse();
      }
    
      return palette;
    }
    
    function getMetricValue(row) {
      const metric =
        byId("metric-select").value;
    
      if (
        metric === "selected_population"
      ) {
        return row.population;
      }
    
      if (
        metric === "cases_per_1000"
      ) {
        return row.casesPer1000;
      }
    
      return row.expectedCases;
    }
    
    function calculateQuantile(
      sortedValues,
      probability
    ) {
      if (!sortedValues.length) {
        return 0;
      }
    
      const position =
        (sortedValues.length - 1) *
        probability;
    
      const lower =
        Math.floor(position);
    
      const upper =
        Math.ceil(position);
    
      if (lower === upper) {
        return sortedValues[lower];
      }
    
      const fraction =
        position - lower;
    
      return (
        sortedValues[lower] *
          (1 - fraction) +
        sortedValues[upper] *
          fraction
      );
    }
    
    function createColourFunction(rows) {
      const palette =
        getSelectedPalette();
    
      const values = rows
        .map(getMetricValue)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
    
      if (!values.length) {
        return {
          colour: () => "#cccccc",
          breaks: new Array(
            palette.length + 1
          ).fill(0),
          palette
        };
      }
    
      const scaleType =
        byId("scale-type-select").value;
    
      const minimum =
        values[0];
    
      const maximum =
        values[values.length - 1];
    
      const breaks = [];
    
      if (scaleType === "quantile") {
        for (
          let index = 0;
          index <= palette.length;
          index += 1
        ) {
          breaks.push(
            calculateQuantile(
              values,
              index / palette.length
            )
          );
        }
      } else {
        const range =
          maximum - minimum || 1;
    
        for (
          let index = 0;
          index <= palette.length;
          index += 1
        ) {
          breaks.push(
            minimum +
            range *
            index /
            palette.length
          );
        }
      }
    
      function colour(value) {
        if (!Number.isFinite(value)) {
          return "#cccccc";
        }
    
        if (maximum === minimum) {
          return palette[
            palette.length - 1
          ];
        }
    
        if (scaleType === "continuous") {
          const proportion =
            (value - minimum) /
            (maximum - minimum);
    
          const index = Math.min(
            palette.length - 1,
            Math.max(
              0,
              Math.floor(
                proportion *
                palette.length
              )
            )
          );
    
          return palette[index];
        }
    
        for (
          let index = 0;
          index < palette.length;
          index += 1
        ) {
          if (
            value <= breaks[index + 1]
          ) {
            return palette[index];
          }
        }
    
        return palette[
          palette.length - 1
        ];
      }
    
      return {
        colour,
        breaks,
        palette
      };
    }
    
    
    /* ============================================================
       MAP
       ============================================================ */
   function initialiseMap() {
    const svgRenderer = L.svg({
      padding: 0.5
    });
  
    state.map = L.map(
      "map",
      {
        minZoom: 5,
        maxZoom: 14,
        worldCopyJump: false,
  
        /*
         * SVG is more reliable than Canvas for complex MSOA
         * MultiPolygon boundaries and avoids triangle artefacts.
         */
        preferCanvas: false,
        renderer: svgRenderer
      }
    );
  
    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        minZoom: 5,
        maxZoom: 14,
        noWrap: true,
  
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">' +
          "OpenStreetMap contributors</a>"
      }
    ).addTo(state.map);
  
    state.map.fitBounds([
      [49, -11],
      [61, 3]
    ]);
  
    state.geoLayer = L.geoJSON(
      state.geojson,
      {
        /*
         * Do not simplify polygon coordinates in the browser.
         * A higher smoothFactor can create artificial triangular
         * joins across detailed MultiPolygon boundaries.
         */
        smoothFactor: 0,
  
        /*
         * Keep each MSOA rendered through SVG rather than Canvas.
         */
        renderer: svgRenderer,
  
        style: {
          fillColor: "#cccccc",
          fillOpacity: 0.8,
          color: "#ffffff",
          weight: 0.1,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round",
          fillRule: "evenodd"
        },
  
        onEachFeature(feature, layer) {
          const code =
            feature.properties
              ?.msoa21_code;
  
          layer.on(
            "click",
            () => {
              state.selectedMsoaCode =
                code;
  
              renderSelectedMsoaProfile();
            }
          );
        }
      }
    ).addTo(state.map);
  }
    
    function renderMap() {
      if (
        !state.map ||
        !state.geoLayer
      ) {
        return;
      }
    
      showMapLoading();
    
      window.setTimeout(() => {
        const displayedByCode =
          new Map(
            state.currentSummary.map(
              row => [row.code, row]
            )
          );
    
        const scale =
          createColourFunction(
            state.currentSummary
          );
    
        const opacity =
          Number(
            byId("opacity-range").value
          );
    
        const borderWeight =
          Number(
            byId("border-range").value
          );
    
        state.geoLayer.eachLayer(layer => {
          const code =
            layer.feature.properties
              ?.msoa21_code;
    
          const row =
            displayedByCode.get(code);
    
          if (!row) {
            layer.setStyle({
              fillOpacity: 0,
              opacity: 0,
              weight: 0
            });
    
            layer.unbindTooltip();
    
            return;
          }
    
          const value =
            getMetricValue(row);
    
          layer.setStyle({
            fillColor:
              scale.colour(value),
    
            fillOpacity:
              Number.isFinite(opacity)
                ? opacity
                : 0.8,
    
            color: "#ffffff",
    
            weight:
              Number.isFinite(borderWeight)
                ? borderWeight
                : 0.1,
    
            opacity: 1
          });
    
          layer.bindTooltip(
            `
              <strong>
                ${escapeHtml(row.name)}
              </strong>
    
              <br>
              ${escapeHtml(row.laName)}
    
              <br>
              Expected CHB cases:
              ${formatNumber(row.expectedCases)}
    
              <br>
              Included population:
              ${formatNumber(row.population)}
    
              <br>
              Cases per 1,000 included:
              ${formatNumber(row.casesPer1000)}
    
              <br>
              National burden rank:
              ${formatInteger(row.nationalRank)}
            `,
            {
              sticky: true
            }
          );
        });
    
        renderLegend(scale);
        hideMapLoading();
      }, 20);
    }
    
    function renderLegend(scale) {
  if (state.legend) {
    state.map.removeControl(
      state.legend
    );
  }

  const metric =
    byId("metric-select").value;

  const title =
    metric === "selected_population"
      ? "Included population"
      : metric === "cases_per_1000"
        ? "Cases per 1,000 included"
        : "Expected CHB cases";

  const minimum =
    scale.breaks.length > 0
      ? scale.breaks[0]
      : 0;

  const maximum =
    scale.breaks.length > 0
      ? scale.breaks[
          scale.breaks.length - 1
        ]
      : 0;

  const gradientStops =
    scale.palette
      .map(
        (colour, index) => {
          const percentage =
            scale.palette.length > 1
              ? (
                  index /
                  (
                    scale.palette.length - 1
                  )
                ) * 100
              : 0;

          return `${colour} ${percentage}%`;
        }
      )
      .join(", ");

  state.legend = L.control({
    position: "bottomright"
  });

  state.legend.onAdd =
    function onAdd() {
      const div =
        L.DomUtil.create(
          "div",
          "leaflet-control leaflet-bar"
        );

      div.style.background =
        "rgba(255, 255, 255, 0.96)";

      div.style.padding =
        "10px 12px";

      div.style.lineHeight =
        "1.3";

      div.style.minWidth =
        "210px";

      div.style.borderRadius =
        "6px";

      div.innerHTML = `
        <div
          style="
            font-weight:600;
            margin-bottom:7px;
            font-size:13px;
          "
        >
          ${escapeHtml(title)}
        </div>

        <div
          style="
            width:190px;
            height:16px;
            border:1px solid rgba(0,0,0,0.22);
            border-radius:3px;
            background:linear-gradient(
              to right,
              ${gradientStops}
            );
          "
        ></div>

        <div
          style="
            display:flex;
            justify-content:space-between;
            width:190px;
            margin-top:4px;
            font-size:11px;
            color:#333333;
          "
        >
          <span>
            ${formatNumber(minimum)}
          </span>

          <span>
            ${formatNumber(maximum)}
          </span>
        </div>
      `;

      L.DomEvent.disableClickPropagation(
        div
      );

      L.DomEvent.disableScrollPropagation(
        div
      );

      return div;
    };

  state.legend.addTo(
    state.map
  );
}
    
    /* ============================================================
       MAP SUMMARY
       ============================================================ */
    
    function renderMapSummary() {
      const rows =
        state.currentSummary;
    
      const expectedCases =
        rows.reduce(
          (total, row) =>
            total + row.expectedCases,
          0
        );
    
      let authorityText;
    
      if (
        state.selectedAuthorities.has("__ALL__") &&
        state.allAreasSelected
      ) {
        authorityText =
          "All Local Authorities";
      } else {
        authorityText =
          `${formatInteger(state.selectedAuthorities.size)} ` +
          "Local Authorities selected";
      }
    
      byId("map-summary").textContent =
        `${authorityText} | ` +
        `${formatInteger(state.selectedCountries.size)} categories selected | ` +
        `${formatInteger(rows.length)} MSOAs displayed | ` +
        `${formatNumber(expectedCases)} expected CHB cases in displayed areas`;
    }
    
    
    /* ============================================================
       SELECTED MSOA PROFILE
       ============================================================ */
    
    function renderSelectedMsoaProfile() {
      const profile =
        byId("msoa-profile");
    
      const tableBody =
        document.querySelector(
          "#msoa-contributions-table tbody"
        );
    
      const chart =
        byId("msoa-contribution-chart");
    
      tableBody.innerHTML = "";
      chart.innerHTML = "";
    
      if (!state.selectedMsoaCode) {
        profile.innerHTML = `
          <p>
            Click a polygon to view its profile.
          </p>
        `;
    
        return;
      }
    
      const row =
        state.nationalSummary.find(
          area =>
            area.code ===
            state.selectedMsoaCode
        );
    
      if (!row) {
        profile.innerHTML = `
          <p>
            No profile is available for this MSOA.
          </p>
        `;
    
        return;
      }
    
      profile.innerHTML = `
        <h3>
          ${escapeHtml(row.name)}
        </h3>
    
        <p>
          ${escapeHtml(row.laName)} |
          ${escapeHtml(row.code)}
        </p>
    
        <p>
          <strong>
            ${formatNumber(row.expectedCases)}
          </strong>
          expected CHB cases
        </p>
    
        <p>
          ${formatNumber(row.population)}
          included residents
        </p>
    
        <p>
          Cases per 1,000 included residents:
          ${formatNumber(row.casesPer1000)}
        </p>
    
        <p>
          National burden rank:
          ${formatInteger(row.nationalRank)}
          of
          ${formatInteger(state.msoaLookup.length)}
        </p>
      `;
    
      const contributions =
        row.contributions
          .slice()
          .sort(
            (a, b) =>
              b.expectedCases -
              a.expectedCases
          );
    
      for (
        const contribution of contributions
      ) {
        const tableRow =
          document.createElement("tr");
    
        tableRow.innerHTML = `
          <td>
            ${escapeHtml(contribution.country)}
          </td>
    
          <td class="numeric">
            ${formatNumber(contribution.population)}
          </td>
    
          <td class="numeric">
            ${formatNumber(contribution.prevalence)}
          </td>
    
          <td class="numeric">
            ${formatNumber(contribution.expectedCases)}
          </td>
        `;
    
        tableBody.appendChild(tableRow);
      }
    
      renderContributionChart(
        contributions
          .filter(
            row =>
              row.expectedCases > 0
          )
          .slice(0, 10)
      );
    }
    
    function renderContributionChart(
      contributions
    ) {
      const container =
        byId("msoa-contribution-chart");
    
      container.innerHTML = "";
    
      if (!contributions.length) {
        container.innerHTML = `
          <p>
            No expected cases for the selected populations.
          </p>
        `;
    
        return;
      }
    
      const maximum =
        Math.max(
          ...contributions.map(
            row => row.expectedCases
          )
        );
    
      for (const row of contributions) {
        const chartRow =
          document.createElement("div");
    
        chartRow.className =
          "bar-chart-row";
    
        const width =
          maximum > 0
            ? 100 *
              row.expectedCases /
              maximum
            : 0;
    
        chartRow.innerHTML = `
          <div
            class="bar-chart-label"
            title="${escapeHtml(row.country)}"
          >
            ${escapeHtml(row.country)}
          </div>
    
          <div class="bar-chart-track">
            <div
              class="bar-chart-bar"
              style="width:${width}%"
            ></div>
          </div>
    
          <div class="bar-chart-value">
            ${formatNumber(row.expectedCases)}
          </div>
        `;
    
        container.appendChild(chartRow);
      }
    }
    
    
    /* ============================================================
       DATATABLE HELPERS
       ============================================================ */
    
    function destroyTable(tableId) {
      if (state.tables[tableId]) {
        state.tables[tableId].destroy();
        state.tables[tableId] = null;
      }
    
      const tbody =
        document.querySelector(
          `#${tableId} tbody`
        );
    
      if (tbody) {
        tbody.innerHTML = "";
      }
    }
    
    function createDataTable(
      tableId,
      options = {}
    ) {
      state.tables[tableId] =
        new DataTable(
          `#${tableId}`,
          {
            pageLength: 25,
    
            lengthMenu: [
              10,
              25,
              50,
              100
            ],
    
            order:
              options.order || [],
    
            deferRender: true,
            autoWidth: false,
            scrollX: true
          }
        );
    }
    
    function appendRows(
      tableId,
      rows
    ) {
      const tbody =
        document.querySelector(
          `#${tableId} tbody`
        );
    
      if (!tbody) {
        throw new Error(
          `Could not find the body of table ${tableId}.`
        );
      }
    
      const fragment =
        document.createDocumentFragment();
    
      for (const cells of rows) {
        const row =
          document.createElement("tr");
    
        row.innerHTML = cells
          .map(
            cell =>
              `<td>${cell}</td>`
          )
          .join("");
    
        fragment.appendChild(row);
      }
    
      tbody.appendChild(fragment);
    }
    
    
    /* ============================================================
       HOTSPOT TABLE
       ============================================================ */
    
    function renderHotspotTable() {
      const rows =
        state.currentSummary.map(row => {
          const topContributors =
            row.contributions
              .slice()
              .sort(
                (a, b) =>
                  b.expectedCases -
                  a.expectedCases
              )
              .filter(
                item =>
                  item.expectedCases > 0
              )
              .slice(0, 3)
              .map(
                item =>
                  `${item.country}: ${formatNumber(item.expectedCases)}`
              )
              .join("; ");
    
          return [
            escapeHtml(row.name),
            escapeHtml(row.code),
            escapeHtml(row.laName),
            formatInteger(row.nationalRank),
            formatNumber(row.expectedCases),
            formatNumber(row.population),
            formatNumber(row.casesPer1000),
            escapeHtml(topContributors)
          ];
        });
    
      destroyTable("hotspot-table");
      appendRows("hotspot-table", rows);
    
      createDataTable(
        "hotspot-table",
        {
          order: [[4, "desc"]]
        }
      );
    }
    
    
    /* ============================================================
       COUNTRY PROFILES
       ============================================================ */
    
    function initialiseProfileCountries() {
      const select =
        byId("profile-country-select");
    
      select.innerHTML = "";
    
      for (
        const country of state.countrySummary
      ) {
        const option =
          document.createElement("option");
    
        option.value = country.COB;
        option.textContent = country.COB;
    
        select.appendChild(option);
      }
    
      select.addEventListener(
        "change",
        renderCountryProfile
      );
    
      byId("view-country-map").addEventListener(
        "click",
        () => {
          const country =
            select.value;
    
          state.selectedCountries =
            new Set([country]);
    
          renderCountryCheckboxes();
          updateAllOutputs();
          openMainTab("map-tab");
        }
      );
    }
    
    function renderCountryProfile() {
      const country =
        byId("profile-country-select").value;
    
      if (!country) {
        return;
      }
    
      const summary =
        state.countrySummary.find(
          row =>
            row.COB === country
        );
    
      if (!summary) {
        return;
      }
    
      byId("country-profile-card").innerHTML = `
        <h3>
          ${escapeHtml(country)}
        </h3>
    
        <p>
          Included Census population:
          ${formatNumber(summary.population)}
        </p>
    
        <p>
          Applied prevalence:
          ${formatNumber(summary.prevalence_percent)}%
        </p>
    
        <p>
          Expected CHB cases:
          ${formatNumber(summary.expected_cases)}
        </p>
      `;
    
      const prevalence =
        state.prevalenceByCountry.get(
          country
        ) || 0;
    
      const countryRows =
        (state.recordsByCountry.get(country) || [])
          .map(record => {
            const area =
              state.msoaByCode.get(
                record.code
              );
    
            return {
              code: record.code,
    
              name:
                area?.msoa21_name ||
                record.code,
    
              laName:
                area?.la_name || "",
    
              population:
                record.population,
    
              expectedCases:
                record.population *
                prevalence /
                100
            };
          })
          .sort(
            (a, b) =>
              b.expectedCases -
              a.expectedCases
          );
    
      countryRows.forEach(
        (row, index) => {
          row.rank = index + 1;
        }
      );
    
      const rows =
        countryRows.map(row => [
          escapeHtml(row.name),
          escapeHtml(row.code),
          escapeHtml(row.laName),
          formatInteger(row.rank),
          formatNumber(row.population),
          formatNumber(row.expectedCases)
        ]);
    
      destroyTable(
        "country-area-table"
      );
    
      appendRows(
        "country-area-table",
        rows
      );
    
      createDataTable(
        "country-area-table",
        {
          order: [[5, "desc"]]
        }
      );
    }
    
    
    /* ============================================================
       LOCAL AUTHORITY TABLES
       ============================================================ */
    
    function initialiseProfileAuthorities() {
      const select =
        byId("profile-authority-select");
    
      select.innerHTML = "";
    
      for (
        const authority of state.authorityLookup
      ) {
        const option =
          document.createElement("option");
    
        option.value =
          authority.la_code;
    
        option.textContent =
          authority.la_name;
    
        select.appendChild(option);
      }
    
      select.addEventListener(
        "change",
        renderAuthorityDetails
      );
    
      byId("view-authority-map").addEventListener(
        "click",
        () => {
          const code =
            select.value;
    
          state.selectedAuthorities =
            new Set([code]);
    
          state.allAreasSelected =
            false;
    
          if (state.authoritySelect) {
            state.authoritySelect.setValue(
              [code],
              true
            );
          }
    
          state.selectedMsoas =
            new Set(
              state.msoaLookup
                .filter(
                  row =>
                    row.la_code === code
                )
                .map(
                  row =>
                    row.msoa21_code
                )
            );
    
          renderMsoaCheckboxes();
          updateAllOutputs();
          openMainTab("map-tab");
        }
      );
    }
    
    function calculateAuthoritySummary() {
      const grouped =
        new Map();
    
      for (
        const row of state.nationalSummary
      ) {
        if (
          row.laCode === "UNKNOWN"
        ) {
          continue;
        }
    
        if (
          !grouped.has(row.laCode)
        ) {
          grouped.set(
            row.laCode,
            {
              code: row.laCode,
              name: row.laName,
              population: 0,
              expectedCases: 0
            }
          );
        }
    
        const authority =
          grouped.get(row.laCode);
    
        authority.population +=
          row.population;
    
        authority.expectedCases +=
          row.expectedCases;
      }
    
      const results =
        Array.from(grouped.values())
          .map(row => ({
            ...row,
    
            casesPer1000:
              row.population > 0
                ? 1000 *
                  row.expectedCases /
                  row.population
                : null
          }))
          .sort(
            (a, b) =>
              b.expectedCases -
              a.expectedCases
          );
    
      results.forEach(
        (row, index) => {
          row.rank = index + 1;
        }
      );
    
      return results;
    }
    
    function renderAuthorityTables() {
      const authorityRows =
        calculateAuthoritySummary();
    
      const rows =
        authorityRows.map(row => [
          escapeHtml(row.name),
          escapeHtml(row.code),
          formatInteger(row.rank),
          formatNumber(row.population),
          formatNumber(row.expectedCases),
          formatNumber(row.casesPer1000)
        ]);
    
      destroyTable("authority-table");
      appendRows("authority-table", rows);
    
      createDataTable(
        "authority-table",
        {
          order: [[4, "desc"]]
        }
      );
    
      renderAuthorityDetails();
    }
    
    function renderAuthorityDetails() {
      const code =
        byId("profile-authority-select").value;
    
      if (!code) {
        return;
      }
    
      const areas =
        state.nationalSummary
          .filter(
            row =>
              row.laCode === code
          )
          .sort(
            (a, b) =>
              b.expectedCases -
              a.expectedCases
          );
    
      const contributions =
        new Map();
    
      for (const area of areas) {
        for (
          const item of area.contributions
        ) {
          if (
            !contributions.has(
              item.country
            )
          ) {
            contributions.set(
              item.country,
              {
                country: item.country,
                population: 0,
                expectedCases: 0
              }
            );
          }
    
          const contribution =
            contributions.get(
              item.country
            );
    
          contribution.population +=
            item.population;
    
          contribution.expectedCases +=
            item.expectedCases;
        }
      }
    
      const contributionRows =
        Array.from(
          contributions.values()
        )
          .sort(
            (a, b) =>
              b.expectedCases -
              a.expectedCases
          )
          .map(row => [
            escapeHtml(row.country),
            formatNumber(row.population),
            formatNumber(row.expectedCases)
          ]);
    
      const contributionBody =
        document.querySelector(
          "#authority-contributions-table tbody"
        );
    
      contributionBody.innerHTML = "";
    
      appendRows(
        "authority-contributions-table",
        contributionRows
      );
    
      const areaRows =
        areas.map(row => [
          escapeHtml(row.name),
          escapeHtml(row.code),
          formatInteger(row.nationalRank),
          formatNumber(row.population),
          formatNumber(row.expectedCases)
        ]);
    
      destroyTable(
        "authority-msoa-table"
      );
    
      appendRows(
        "authority-msoa-table",
        areaRows
      );
    
      createDataTable(
        "authority-msoa-table",
        {
          order: [[4, "desc"]]
        }
      );
    }
    
    
    /* ============================================================
       DATA TABLES
       ============================================================ */
    
    function renderMainDataTables() {
      renderCountryDataTable();
      renderMsoaDataTable();
    }
    
    function renderCountryDataTable() {
      const rows =
        state.countrySummary.map(row => [
          escapeHtml(row.COB),
          formatNumber(row.population),
          formatNumber(row.prevalence_percent),
          formatNumber(row.expected_cases)
        ]);
    
      destroyTable(
        "country-data-table"
      );
    
      appendRows(
        "country-data-table",
        rows
      );
    
      createDataTable(
        "country-data-table",
        {
          order: [[3, "desc"]]
        }
      );
    }
    
    function renderMsoaDataTable() {
      const rows =
        state.nationalSummary.map(row => [
          escapeHtml(row.name),
          escapeHtml(row.code),
          escapeHtml(row.laName),
          formatInteger(row.nationalRank),
          formatNumber(row.population),
          formatNumber(row.expectedCases),
          formatNumber(row.casesPer1000)
        ]);
    
      destroyTable(
        "msoa-data-table"
      );
    
      appendRows(
        "msoa-data-table",
        rows
      );
    
      createDataTable(
        "msoa-data-table",
        {
          order: [[5, "desc"]]
        }
      );
    }
    
    function renderDetailTable() {
      const filtered =
        state.detail
          .filter(
            row =>
              state.selectedCountries.has(
                row.COB
              )
          )
          .slice(0, 10000);
    
      const rows =
        filtered.map(row => {
          const area =
            state.msoaByCode.get(
              row.msoa21_code
            );
    
          const prevalence =
            state.prevalenceByCountry.get(
              row.COB
            ) || 0;
    
          const expectedCases =
            Number(row.population) *
            prevalence /
            100;
    
          return [
            escapeHtml(
              area?.msoa21_name ||
              row.msoa21_code
            ),
    
            escapeHtml(
              row.msoa21_code
            ),
    
            escapeHtml(
              area?.la_name || ""
            ),
    
            escapeHtml(
              row.COB
            ),
    
            formatNumber(
              row.population
            ),
    
            formatNumber(
              prevalence
            ),
    
            formatNumber(
              expectedCases
            )
          ];
        });
    
      destroyTable(
        "detail-data-table"
      );
    
      appendRows(
        "detail-data-table",
        rows
      );
    
      createDataTable(
        "detail-data-table",
        {
          order: [[6, "desc"]]
        }
      );
    }
    
    
    /* ============================================================
       CSV DOWNLOADS
       ============================================================ */
    
    function csvEscape(value) {
      const text =
        String(value ?? "");
    
      return `"${text.replaceAll(
        '"',
        '""'
      )}"`;
    }
    
    function downloadCsv(
      filename,
      headers,
      rows
    ) {
      const output = [
        headers
          .map(csvEscape)
          .join(","),
    
        ...rows.map(row =>
          row
            .map(csvEscape)
            .join(",")
        )
      ].join("\r\n");
    
      const blob =
        new Blob(
          [output],
          {
            type:
              "text/csv;charset=utf-8"
          }
        );
    
      const url =
        URL.createObjectURL(blob);
    
      const link =
        document.createElement("a");
    
      link.href = url;
      link.download = filename;
    
      document.body.appendChild(link);
      link.click();
      link.remove();
    
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    }
    
    function todayString() {
      return new Date()
        .toISOString()
        .slice(0, 10);
    }
    
    function initialiseDownloads() {
      byId("download-hotspots").addEventListener(
        "click",
        () => {
          downloadCsv(
            `CHB_hotspots_${todayString()}.csv`,
    
            [
              "MSOA name",
              "MSOA code",
              "Local Authority",
              "National rank",
              "Expected CHB cases",
              "Included population",
              "Cases per 1,000 included residents"
            ],
    
            state.currentSummary.map(
              row => [
                row.name,
                row.code,
                row.laName,
                row.nationalRank,
                row.expectedCases,
                row.population,
                row.casesPer1000
              ]
            )
          );
        }
      );
    
      byId("download-country").addEventListener(
        "click",
        () => {
          downloadCsv(
            `CHB_country_${todayString()}.csv`,
    
            [
              "Country of birth",
              "Population",
              "Prevalence (%)",
              "Expected CHB cases"
            ],
    
            state.countrySummary.map(
              row => [
                row.COB,
                row.population,
                row.prevalence_percent,
                row.expected_cases
              ]
            )
          );
        }
      );
    
      byId("download-msoa").addEventListener(
        "click",
        () => {
          downloadCsv(
            `CHB_MSOA_${todayString()}.csv`,
    
            [
              "MSOA name",
              "MSOA code",
              "Local Authority",
              "National rank",
              "Included population",
              "Expected CHB cases",
              "Cases per 1,000 included residents"
            ],
    
            state.nationalSummary.map(
              row => [
                row.name,
                row.code,
                row.laName,
                row.nationalRank,
                row.population,
                row.expectedCases,
                row.casesPer1000
              ]
            )
          );
        }
      );
    
      byId("download-detail").addEventListener(
        "click",
        () => {
          const rows =
            state.detail
              .filter(
                row =>
                  state.selectedCountries.has(
                    row.COB
                  )
              )
              .map(row => {
                const area =
                  state.msoaByCode.get(
                    row.msoa21_code
                  );
    
                const prevalence =
                  state.prevalenceByCountry.get(
                    row.COB
                  ) || 0;
    
                const cases =
                  Number(row.population) *
                  prevalence /
                  100;
    
                return [
                  area?.msoa21_name ||
                    row.msoa21_code,
    
                  row.msoa21_code,
    
                  area?.la_name || "",
    
                  row.COB,
    
                  row.population,
    
                  prevalence,
    
                  cases
                ];
              });
    
          downloadCsv(
            `CHB_MSOA_country_${todayString()}.csv`,
    
            [
              "MSOA name",
              "MSOA code",
              "Local Authority",
              "Country of birth",
              "Population",
              "Prevalence (%)",
              "Expected CHB cases"
            ],
    
            rows
          );
        }
      );
    
      byId("download-authorities").addEventListener(
        "click",
        () => {
          const rows =
            calculateAuthoritySummary();
    
          downloadCsv(
            `CHB_Local_Authorities_${todayString()}.csv`,
    
            [
              "Local Authority",
              "Authority code",
              "Rank",
              "Included population",
              "Expected CHB cases",
              "Cases per 1,000 included residents"
            ],
    
            rows.map(row => [
              row.name,
              row.code,
              row.rank,
              row.population,
              row.expectedCases,
              row.casesPer1000
            ])
          );
        }
      );
    
      byId("download-country-profile").addEventListener(
        "click",
        () => {
          const country =
            byId(
              "profile-country-select"
            ).value;
    
          const prevalence =
            state.prevalenceByCountry.get(
              country
            ) || 0;
    
          const rows =
            (
              state.recordsByCountry.get(
                country
              ) || []
            ).map(record => {
              const area =
                state.msoaByCode.get(
                  record.code
                );
    
              return [
                area?.msoa21_name ||
                  record.code,
    
                record.code,
    
                area?.la_name || "",
    
                record.population,
    
                record.population *
                  prevalence /
                  100
              ];
            });
    
          downloadCsv(
            `CHB_country_profile_${todayString()}.csv`,
    
            [
              "MSOA name",
              "MSOA code",
              "Local Authority",
              "Population",
              "Expected CHB cases"
            ],
    
            rows
          );
        }
      );
    }
    
    
    /* ============================================================
       MAP CONTROL LISTENERS
       ============================================================ */
    
    function initialiseMapControls() {
      const controlIds = [
        "metric-select",
        "threshold-select",
        "top-n-select",
        "palette-select",
        "scale-type-select",
        "reverse-palette"
      ];
    
      for (const id of controlIds) {
        byId(id).addEventListener(
          "change",
          updateAllOutputs
        );
      }
    
      byId("opacity-range").addEventListener(
        "input",
        event => {
          byId(
            "opacity-value"
          ).textContent =
            event.target.value;
    
          renderMap();
        }
      );
    
      byId("border-range").addEventListener(
        "input",
        event => {
          byId(
            "border-value"
          ).textContent =
            event.target.value;
    
          renderMap();
        }
      );
    }
    
    
    /* ============================================================
       CENTRAL UPDATE
       ============================================================ */
    
    function updateAllOutputs() {
      if (!state.dataLoaded) {
        return;
      }
    
      state.nationalSummary =
        calculateNationalSummary();
    
      state.currentSummary =
        calculateDisplayedSummary();
    
      renderMapSummary();
      renderMap();
      renderSelectedMsoaProfile();
    
      if (
        byId("hotspots")
          .classList
          .contains("active")
      ) {
        renderHotspotTable();
      }
    
      if (
        byId("country-profiles")
          .classList
          .contains("active")
      ) {
        renderCountryProfile();
      }
    
      if (
        byId("local-authorities")
          .classList
          .contains("active")
      ) {
        renderAuthorityTables();
      }
    
      if (
        byId("data-tab")
          .classList
          .contains("active")
      ) {
        renderMainDataTables();
      }
    }
    
    
    /* ============================================================
       INITIALISE APPLICATION
       ============================================================ */
    
    async function initialiseApplication() {
      try {
        initialiseNavigation();
    
        await loadData();
    
        setLoadingMessage(
          "Preparing website indices..."
        );
    
        buildIndices();
    
        setLoadingMessage(
          "Building filters and map..."
        );
    
        renderOverview();
    
        initialiseAuthoritySelector();
        initialiseMsoaButtons();
    
        renderCountryCheckboxes();
        initialiseCountryButtons();
    
        initialiseProfileCountries();
        initialiseProfileAuthorities();
    
        initialiseMap();
        initialiseMapControls();
        initialiseDownloads();
    
        renderMsoaCheckboxes();
    
        updateAllOutputs();
    
        hideLoadingScreen();
      } catch (error) {
        showFatalError(error);
      }
    }
    
    
    /* ============================================================
       START
       ============================================================ */
    
    document.addEventListener(
      "DOMContentLoaded",
      initialiseApplication
    );