import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";

const Watchlist = () => {
    const [positions, setPositions] = useState([]);

    useEffect(() => {
        axios.get("/api/me/watching").then((response) => {
            setPositions(response.data);
        });
    }, []);

    return (
        <div className="Watchlist">
            <h2>Watchlist</h2>
            {positions.map((position) => (
                <Link key={position.id} className="list-item" to={`/positions/${position.id}`}>
                    {position.name}
                </Link>
            ))}
            {positions.length === 0 && <p>You are not watching any positions.</p>}
        </div>
    );
};

export default Watchlist;
