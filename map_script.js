(function () {
    // Global variables within IIFE scope
    const endpointUrl = 'https://query.wikidata.org/sparql';
    let map;
    let currentMarkers = []; // To keep track of current markers for removal
    let movementDataCache = {}; // Cache for pre-fetched movement data
    let detailsPanel; // To store the jQuery object for the details panel

    // SPARQL Query Functions
    function makeSPARQLQuery(endpointUrl, sparqlQuery, doneCallback) {
        var settings = {
            headers: { Accept: 'application/sparql-results+json' },
            data: { query: sparqlQuery }
        };
        return $.ajax(endpointUrl, settings).then(doneCallback);
    }

    function queryPaintersAndArtworks(artisticMovementURI) {
        if (!artisticMovementURI) {
            console.warn("queryPaintersAndArtworks called without an artisticMovementURI");
            return ""; // Return an empty query or handle error
        }
        // Using template literal for clarity
        const sparqlQuery = `SELECT
?painter ?painterLabel ?painterDescription
?placeOfBirthLabel
?lat ?lon
?dateOfBirth ?dateOfDeath
(SAMPLE(?artworkLabel) AS ?sampledArtworkLabel)
(SAMPLE(?artworkImage) AS ?sampledArtworkImage)
(SAMPLE(?painterImage) AS ?sampledPainterImage)
(SAMPLE(?article) AS ?wikipediaArticle) # Added to get Wikipedia article URL
WHERE {
VALUES ?movement { <${artisticMovementURI}> } # Filter by selected movement
?painter wdt:P31 wd:Q5; # instance of human
         wdt:P106 wd:Q1028181; # occupation painter
         wdt:P19 ?placeOfBirth;  # place of birth
         wdt:P135 ?movement.   # artistic movement

?placeOfBirth p:P625/psv:P625 [ # coordinate location
    wikibase:geoLatitude ?lat;
    wikibase:geoLongitude ?lon
].

OPTIONAL { ?painter wdt:P569 ?dateOfBirth. }
OPTIONAL { ?painter wdt:P570 ?dateOfDeath. }

OPTIONAL {
  ?artwork wdt:P170 ?painter; # artwork created by painter
           wdt:P31/wdt:P279* wd:Q11060274; # instance of visual artwork (or subclass)
           wdt:P18 ?artworkImage.
  OPTIONAL { ?artwork rdfs:label ?artworkLabel FILTER(LANG(?artworkLabel) IN ("es", "en")). }
}

OPTIONAL { ?painter wdt:P18 ?painterImage. } # Image of the painter

OPTIONAL { # To get the Spanish Wikipedia article URL
  ?article schema:about ?painter ;
           schema:inLanguage "es" ;
           schema:isPartOf <https://es.wikipedia.org/> .
}

SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],es,en". }
}
GROUP BY ?painter ?painterLabel ?painterDescription ?placeOfBirthLabel ?lat ?lon ?dateOfBirth ?dateOfDeath
ORDER BY RAND()
LIMIT 100`;
        return sparqlQuery;
    }

    // DOM Manipulation and UI Functions (addOptions is not used currently)
    /* function addOptions(domElement, json) {
        var select = document.getElementsByName(domElement)[0];
        json.forEach(function(info) {
            var itemVal = info.item.value; // Generic item value
            var itemLabel = info.itemLabel.value; // Generic item label
            var option = document.createElement("option");
            option.text = itemLabel;
            option.value = itemVal;
            select.add(option);
        });
    } */

    // Map Related Functions
    function createMap(options) {
        // Ensure map variable is assigned to the IIFE's scoped map variable
        map = L.map('map', options);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png?{foo}', {
            foo: 'bar',
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        // No need to return map if it's assigned to the outer scope variable directly
    }

    function addPOIs(pois) { // mapInstance parameter removed, uses scoped map variable
        // Clear existing markers
        currentMarkers.forEach(function (marker) {
            map.removeLayer(marker); // Use scoped map variable
        });
        currentMarkers = [];
        clearDetailsPanel(); // Clear details panel when new POIs are being added

        pois.forEach(function (info) {
            const myIcon = L.icon({
                iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
                iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
                shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            });

            const painterLabel = info.painterLabel ? info.painterLabel.value : "Artista Desconocido";
            const painterDescription = info.painterDescription ? info.painterDescription.value : "";
            const birthPlaceLabel = info.placeOfBirthLabel ? info.placeOfBirthLabel.value : "Lugar de nacimiento desconocido";

            const dobValue = info.dateOfBirth ? info.dateOfBirth.value : null;
            const dodValue = info.dateOfDeath ? info.dateOfDeath.value : null;

            let birthDateFormatted = "";
            if (dobValue) {
                try {
                    birthDateFormatted = new Date(dobValue).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
                } catch (e) {
                    console.error("Error formatting birth date:", dobValue, e);
                }
            }

            let deathDateFormatted = "";
            if (dodValue) {
                try {
                    deathDateFormatted = new Date(dodValue).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
                } catch (e) {
                    console.error("Error formatting death date:", dodValue, e);
                }
            }

            let lifespan = "";
            if (birthDateFormatted && deathDateFormatted) {
                lifespan = `(${birthDateFormatted} - ${deathDateFormatted})`;
            } else if (birthDateFormatted) {
                lifespan = `(Nacido: ${birthDateFormatted})`;
            }

            const artworkImageUrl = info.sampledArtworkImage ? info.sampledArtworkImage.value : null;
            const painterImageUrl = info.sampledPainterImage ? info.sampledPainterImage.value : null;
            const placeholderImageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Placeholder_view_vector.svg/640px-Placeholder_view_vector.svg.png';
            let rawFinalImageUrl = artworkImageUrl || painterImageUrl || placeholderImageUrl;
            let finalImageUrl = rawFinalImageUrl;

            const commonsPrefix = "https://upload.wikimedia.org/wikipedia/commons/";
            if (rawFinalImageUrl.startsWith(commonsPrefix) && rawFinalImageUrl !== placeholderImageUrl) {
                try {
                    const imagePathWithHash = rawFinalImageUrl.substring(commonsPrefix.length);
                    // Filename might contain characters needing encoding for the URL path component construction for thumbnail service
                    // However, the final part of the thumbnail URL (after /300px-) should be the original filename, not double-encoded.
                    const filename = decodeURIComponent(imagePathWithHash.substring(imagePathWithHash.lastIndexOf('/') + 1));
                    const encodedImagePath = imagePathWithHash.split('/').map(segment => encodeURIComponent(segment)).join('/');
                    finalImageUrl = `${commonsPrefix}thumb/${encodedImagePath}/300px-${filename}`;
                } catch (e) {
                    console.error("Error constructing thumbnail URL for: " + rawFinalImageUrl, e);
                    finalImageUrl = rawFinalImageUrl; // Fallback to original if error
                }
            }

            if (finalImageUrl !== placeholderImageUrl) {
                const preloader = new Image();
                preloader.src = finalImageUrl;
            }

            let artworkTitle = info.sampledArtworkLabel ? info.sampledArtworkLabel.value : "";
            if (!artworkTitle && artworkImageUrl) artworkTitle = "Obra destacada";
            else if (!artworkTitle && painterImageUrl && !artworkImageUrl) artworkTitle = "Retrato del artista";
            else if (!artworkTitle && !artworkImageUrl && !painterImageUrl) artworkTitle = "Información visual no disponible";

            // Using template literals for improved readability of HTML string
            // Image and artwork title removed from the popup as per request
            const textpopup = `
<div id="content" style="font-family: sans-serif; max-width:300px;">
    <h3 style="margin-top:0; margin-bottom: 5px;">${painterLabel}</h3>
    ${lifespan ? `<p style="font-size:0.8em; margin-top:0; margin-bottom: 5px;">${lifespan}</p>` : ''}
    <p style="font-size:0.9em; margin-top:0; margin-bottom: 5px;"><strong>Nacido en:</strong> ${birthPlaceLabel}</p>
    ${painterDescription ? `<p style="font-size:0.85em; margin-top:0; margin-bottom:10px; font-style:italic;">${painterDescription}</p>` : ''}
</div>`;

            const newMarker = L.marker([info.lat.value, info.lon.value], { icon: myIcon })
                .addTo(map) // Use scoped map variable
                .bindPopup(textpopup, { maxHeight: 350, maxWidth: 300 });

            newMarker.on('click', function () {
                this.openPopup();
                updateDetailsPanel(info); // Update details panel on marker click
            });

            currentMarkers.push(newMarker);
        });
    }

    // Main execution block (document ready)
    $(function () {
        detailsPanel = $('#details-panel'); // Cache the details panel element

        const initialMapOptions = {
            center: [45, 10], // Adjusted center for Europe/broader view
            minZoom: 2,
            zoom: 4 // Slightly more zoomed out
        };
        createMap(initialMapOptions); // Initialize the map

        // Pre-fetch data for all movements
        $('#artisticMovement option').each(function() {
            const movementURI = $(this).val();
            if (movementURI) { // Check if value is not empty
                const sparqlQueryContent = queryPaintersAndArtworks(movementURI);
                if (sparqlQueryContent) {
                    makeSPARQLQuery(endpointUrl, sparqlQueryContent, function (data) {
                        console.log("Pre-fetched painters for movement " + movementURI + ":", data.results.bindings);
                        movementDataCache[movementURI] = data.results.bindings;
                    }).fail(function(jqXHR, textStatus, errorThrown) {
                        console.error("Failed to pre-fetch data for movement " + movementURI + ": " + textStatus, errorThrown);
                    });
                }
            }
        });

        // Event listener for the "Actualizar" button
        $('input[type="button"]').on('click', () => {
            const selectedMovementURI = $('#artisticMovement').val();
            if (!selectedMovementURI) {
                alert("Por favor, seleccione un movimiento artístico.");
                currentMarkers.forEach(function (marker) {
                    map.removeLayer(marker);
                });
                currentMarkers = [];
                clearDetailsPanel(); // Clear details panel
                return;
            }

            // Use cached data
            if (movementDataCache[selectedMovementURI]) {
                console.log("Using cached painters for movement " + selectedMovementURI + ":", movementDataCache[selectedMovementURI]);
                addPOIs(movementDataCache[selectedMovementURI]);
            } else {
                // Fallback or error handling if data not in cache (should ideally be there)
                console.warn("Data for movement " + selectedMovementURI + " not found in cache. Fetching now.");
                // Optionally, fetch it now (as per original logic)
                const sparqlQueryContent = queryPaintersAndArtworks(selectedMovementURI);
                if (sparqlQueryContent) {
                    makeSPARQLQuery(endpointUrl, sparqlQueryContent, function (data) {
                        console.log("Painters for movement " + selectedMovementURI + ":", data.results.bindings);
                        movementDataCache[selectedMovementURI] = data.results.bindings; // Cache it
                        addPOIs(data.results.bindings);
                    }).fail(function(jqXHR, textStatus, errorThrown) {
                        console.error("Failed to fetch data for movement " + selectedMovementURI + " on demand: " + textStatus, errorThrown);
                         // Clear markers if fetching fails
                        currentMarkers.forEach(function (marker) {
                            map.removeLayer(marker);
                        });
                        currentMarkers = [];
                        clearDetailsPanel(); // Clear details panel on demand fetch failure
                    });
                } else {
                     // Clear markers if the query is empty (e.g., error or no movement selected)
                    currentMarkers.forEach(function (marker) {
                        map.removeLayer(marker);
                    });
                    currentMarkers = [];
                    clearDetailsPanel(); // Clear details panel
                }
            }
        });

        // Automatically load data for the default selected movement
        if ($('#artisticMovement').val()) { // Ensure a movement is actually selected
            $('input[type="button"]').trigger('click');
        }
    });

    function updateDetailsPanel(info) {
        if (!detailsPanel) return;

        const painterLabel = info.painterLabel ? info.painterLabel.value : "Artista Desconocido";
        const painterDescription = info.painterDescription ? info.painterDescription.value : "Sin descripción disponible.";
        const birthPlaceLabel = info.placeOfBirthLabel ? info.placeOfBirthLabel.value : "Lugar de nacimiento desconocido";

        const dobValue = info.dateOfBirth ? info.dateOfBirth.value : null;
        const dodValue = info.dateOfDeath ? info.dateOfDeath.value : null;

        let birthDateFormatted = "Fecha de nacimiento desconocida";
        if (dobValue) {
            try {
                birthDateFormatted = new Date(dobValue).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
            } catch (e) { /* console.error("Error formatting birth date for details panel:", dobValue, e); */ }
        }

        let deathDateFormatted = "Fecha de fallecimiento desconocida";
        if (dodValue) {
            try {
                deathDateFormatted = new Date(dodValue).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
            } catch (e) { /* console.error("Error formatting death date for details panel:", dodValue, e); */ }
        }
        
        let lifespanDetail = "";
        if (dobValue && dodValue) {
            lifespanDetail = `${birthDateFormatted} - ${deathDateFormatted}`;
        } else if (dobValue) {
            lifespanDetail = `Nacido/a: ${birthDateFormatted}`;
        } else {
            lifespanDetail = "Periodo vital desconocido";
        }

        const artworkImageUrl = info.sampledArtworkImage ? info.sampledArtworkImage.value : null;
        const painterImageUrl = info.sampledPainterImage ? info.sampledPainterImage.value : null;
        const placeholderImageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Placeholder_view_vector.svg/640px-Placeholder_view_vector.svg.png';
        let rawFinalImageUrl = artworkImageUrl || painterImageUrl || placeholderImageUrl;
        let finalImageUrl = rawFinalImageUrl;

        const commonsPrefix = "https://upload.wikimedia.org/wikipedia/commons/";
        if (rawFinalImageUrl.startsWith(commonsPrefix) && rawFinalImageUrl !== placeholderImageUrl) {
            try {
                const imagePathWithHash = rawFinalImageUrl.substring(commonsPrefix.length);
                const filename = decodeURIComponent(imagePathWithHash.substring(imagePathWithHash.lastIndexOf('/') + 1));
                const encodedImagePath = imagePathWithHash.split('/').map(segment => encodeURIComponent(segment)).join('/');
                finalImageUrl = `${commonsPrefix}thumb/${encodedImagePath}/400px-${filename}`; 
            } catch (e) {
                finalImageUrl = rawFinalImageUrl; 
            }
        }

        let artworkTitle = info.sampledArtworkLabel ? info.sampledArtworkLabel.value : "";
        if (!artworkTitle && artworkImageUrl) artworkTitle = "Obra destacada";
        else if (!artworkTitle && painterImageUrl && !artworkImageUrl) artworkTitle = "Retrato del artista";
        else if (!artworkTitle && !artworkImageUrl && !painterImageUrl) artworkTitle = "Información visual no disponible";
        
        const detailsHtml = `
            <h2 style="margin-top:0;">${painterLabel}</h2>
            <p><strong>Periodo Vital:</strong> ${lifespanDetail}</p>
            <p><strong>Lugar de Nacimiento:</strong> ${birthPlaceLabel}</p>
            <p><em>${painterDescription}</em></p>
            <div style="text-align:center; margin-top:15px;">
                <img src="${finalImageUrl}" alt="${artworkTitle}" style="max-width:100%; max-height:300px; border:1px solid #ccc; object-fit: contain;" />
                ${artworkTitle ? `<p style="font-size:0.9em; margin-top:5px;"><em>${artworkTitle}</em></p>` : ''}
            </div>
            <div id="wikipedia-summary-container" style="margin-top:15px;">
                <p><em>Cargando resumen de Wikipedia...</em></p>
            </div>
        `;
        detailsPanel.html(detailsHtml);

        // Fetch and display Wikipedia summary
        const wikipediaArticleUrl = info.wikipediaArticle ? info.wikipediaArticle.value : null;
        if (wikipediaArticleUrl) {
            fetchWikipediaSummary(wikipediaArticleUrl, 
                function(summary) { // Success callback
                    const summaryContainer = detailsPanel.find('#wikipedia-summary-container');
                    summaryContainer.html(`<h4 style="margin-bottom:5px;">Resumen de Wikipedia:</h4><p style="font-size:0.9em;">${summary}</p><p><a href="${wikipediaArticleUrl}" target="_blank">Leer más en Wikipedia</a></p>`);
                },
                function(errorMsg) { // Error callback
                    const summaryContainer = detailsPanel.find('#wikipedia-summary-container');
                    summaryContainer.html(`<p style="font-size:0.9em; color:grey;"><em>${errorMsg}</em></p>`);
                }
            );
        } else {
            const summaryContainer = detailsPanel.find('#wikipedia-summary-container');
            summaryContainer.html('<p style="font-size:0.9em; color:grey;"><em>No se encontró artículo de Wikipedia para este pintor.</em></p>');
        }
    }

    function fetchWikipediaSummary(pageUrl, callbackSuccess, callbackError) {
        if (!pageUrl) {
            if (callbackError) callbackError("No Wikipedia URL provided.");
            return;
        }
        // Extract title from URL. Example: https://es.wikipedia.org/wiki/Leonardo_da_Vinci -> Leonardo_da_Vinci
        let pageTitle = pageUrl.substring(pageUrl.lastIndexOf('/') + 1);
        
        try {
            // Decode the extracted title to handle URI-encoded characters (e.g., %C3%AD for í)
            pageTitle = decodeURIComponent(pageTitle);
        } catch (e) {
            console.error("Failed to decode page title:", pageTitle, e);
            if (callbackError) callbackError("Título de Wikipedia malformado o inválido.");
            return;
        }

        if (!pageTitle) { // Check after substring and potential decoding
             if (callbackError) callbackError("Could not extract title from Wikipedia URL.");
            return;
        }

        const WIKIPEDIA_API_ENDPOINT = 'https://es.wikipedia.org/w/api.php';

        $.ajax({
            url: WIKIPEDIA_API_ENDPOINT,
            data: {
                action: 'query',
                format: 'json',
                prop: 'extracts',
                exintro: true,
                explaintext: true,
                redirects: 1,
                titles: pageTitle,
                origin: '*'
            },
            dataType: 'jsonp', // Using jsonp for cross-domain requests
            success: function(response) {
                try {
                    const pages = response.query.pages;
                    const pageId = Object.keys(pages)[0]; // Get the first page ID
                    if (pageId && pages[pageId].extract) {
                        if (callbackSuccess) callbackSuccess(pages[pageId].extract);
                    } else if (pages[pageId] && pages[pageId].missing !== undefined) {
                        if (callbackError) callbackError("La página de Wikipedia no fue encontrada o no tiene resumen.");
                    } else {
                        if (callbackError) callbackError("No se pudo extraer el resumen de Wikipedia.");
                    }
                } catch (e) {
                    console.error("Error parsing Wikipedia API response:", e);
                    if (callbackError) callbackError("Error al procesar la respuesta de Wikipedia.");
                }
            },
            error: function(jqXHR, textStatus, errorThrown) {
                console.error("Wikipedia API request failed: " + textStatus, errorThrown);
                if (callbackError) callbackError("No se pudo contactar con Wikipedia para obtener el resumen.");
            }
        });
    }

    function clearDetailsPanel() {
        if (!detailsPanel) return;
        detailsPanel.html('<p>Haz clic en un marcador en el mapa para ver los detalles aquí.</p>');
    }

})(); // Immediately Invoked Function Expression

// The myOnLoad function and its call were removed as it was empty and unused.
// The addOptions function is currently not used and has been commented out.
// The cargar_peliculas function and its call in myOnLoad were removed previously.
// The queryPeliculas function was also removed as it was part of the unused cargar_peliculas. 