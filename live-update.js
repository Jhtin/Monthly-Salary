(() => {
  window.workdayApplyCloudState = function(remoteState) {
    try {
      if (!remoteState || typeof state !== "object" || !state || typeof render !== "function") {
        return false;
      }

      const next = JSON.parse(JSON.stringify(remoteState));
      Object.keys(state).forEach(key => delete state[key]);
      Object.assign(state, next);

      if (!state.activeEmployeeId || !Array.isArray(state.employees) || !state.employees.some(e => e.id === state.activeEmployeeId)) {
        state.activeEmployeeId = state.employees?.[0]?.id || null;
      }

      document.body.classList.toggle("dark", state.theme === "dark");
      render();
      return true;
    } catch (error) {
      console.error("Workday live update bridge error", error);
      return false;
    }
  };
})();