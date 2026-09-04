import React, { useState } from "react";
import { Link } from "react-router-dom";
import Dashboard from "./dashboard/Dashboard";

const Home = () => {
    const [toggleDashboard, setToggleDashboard] = useState(true);

    return (
        <div className="HomeRecruiter">
            <div className="HomeRecruiter_links">
                <Link to="/hirings">Your hirings</Link>
                <a
                    onClick={() => {
                        setToggleDashboard((prev) => !prev);
                    }}
                >
                    Dashboard
                </a>
                <Link to="/position/create">Create a Position</Link>
            </div>
            {toggleDashboard && (
                <Dashboard setToggleDashboard={setToggleDashboard} />
            )}
        </div>
    );
};

export default Home;
