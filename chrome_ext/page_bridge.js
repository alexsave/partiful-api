(() => {
  if (window.__EXT_PAGE_BRIDGE__) return;
  window.__EXT_PAGE_BRIDGE__ = true;

  // Listen for commands from the content script
  document.addEventListener('EXT_BRIDGE_CALL', async (evt) => {
    const { callId, name, args } = evt.detail || {};
    const respond = (payload) => {
      document.dispatchEvent(new CustomEvent('EXT_BRIDGE_RETURN', { detail: { callId, payload } }));
    };
    try {
      if (name === 'collectAlaska') {
        const result = (function collectAlaska() {
          try {
            let flightDivs = Array.from(document.querySelectorAll('.matrixRow'));
            flightDivs = flightDivs.filter(function(x){ return !x.querySelector('auro-flight-segment'); });
            const results = [];
            for (const flightDiv of flightDivs) {
              try {
                const comp = flightDiv.querySelector('fs-auro-flight');
                const headerEl = comp && comp.shadowRoot && comp.shadowRoot.querySelector('auro-flight-header');
                const flightsArr = headerEl && headerEl.flights;
                if (!flightsArr || !flightsArr.length) { continue; }
                let fareDivs = Array.from(flightDiv.querySelectorAll('.valuetile')).filter(function(x){ return !x.querySelector('.unavailable-container'); });
                const fares = fareDivs.map(function(fareDiv){
                  const classNode = fareDiv.querySelector('.class-of-service');
                  const pointsNode = fareDiv.querySelector('.points');
                  const currencyNode = fareDiv.querySelector('.currency-container');
                  const classOfService = classNode ? classNode.textContent.trim() : null;
                  const rawPoints = pointsNode ? pointsNode.textContent : null;
                  const points = rawPoints ? parseFloat(rawPoints.replace('k points','')) * 1000 : null;
                  const rawMoney = currencyNode ? currencyNode.textContent : null;
                  const moneyUsd = rawMoney ? parseInt(rawMoney.replace('+ $','').trim()) : null;
                  return { classOfService, points, moneyUsd };
                });
                results.push({
                  flightId: flightsArr[0],
                  duration: headerEl && headerEl.duration != null ? headerEl.duration : null,
                  departureTime: headerEl && headerEl.departureTime != null ? headerEl.departureTime : null,
                  arrivalTime: headerEl && headerEl.arrivalTime != null ? headerEl.arrivalTime : null,
                  fares
                });
              } catch (_) {}
            }
            return { timeFound: new Date().toISOString(), flights: results };
          } catch (e) {
            return { __error: String(e) };
          }
        })();
        respond(result);
      } else {
        respond({ __error: 'Unknown bridge call: ' + name });
      }
    } catch (e) {
      respond({ __error: String(e) });
    }
  });
})();


