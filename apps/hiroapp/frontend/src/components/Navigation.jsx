import React, { useContext } from "react";
import Context from "../context/Context";
import { Link } from "react-router-dom";

const Navigation = () => {
    const { state } = useContext(Context);
    return (
        <>
            <nav className="Navigation">
                {state.user?.role_id === 1 && (
                    <>
                        <Link to="/">Home</Link>
                        <Link to="/users/create">Create New User</Link>
                        <Link to="/failed-jobs">Failed Jobs</Link>
                    </>
                )}
                {state.user?.role_id === 2 && (
                    <>
                        <Link to="/">Home</Link>
                        <Link to="/applications">Your Applications</Link>
                        <Link to="/positions">Positions</Link>
                        <Link to="/skills">Skills</Link>
                        <Link to="/watching">Watchlist</Link>
                    </>
                )}
                {state.user?.role_id === 3 && (
                    <>
                        <Link to="/">Home</Link>
                        <Link to="/position/create">Create New Position</Link>
                        <Link to="/skills">Skills</Link>
                    </>
                )}
            </nav>
        </>
    );
};

export default Navigation;
