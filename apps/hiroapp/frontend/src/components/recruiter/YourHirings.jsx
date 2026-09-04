import axios from "axios";
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const YourHirings = () => {
    const [hirings, setHirings] = useState([]);
    const navigate = useNavigate();

    const fetchHirings = async () => {
        try {
            const response = await axios.get("/api/positions");
            setHirings(response.data);
        } catch (error) {
            console.log("UNKNOWN ERROR", error.response.data);
        }
    };

    useEffect(() => {
        fetchHirings();
    }, []);

    return (
        <div className="YourHirings">
            <h2>Hirings in your Department</h2>
            <button onClick={() => navigate(-1)}>back</button>
            <div className="hirings_container">
                {hirings.map((hiring) => (
                    <div key={hiring.id}>
                        <Link to={"/positions/" + hiring.id}>
                            <h4>{hiring.name}</h4>
                        </Link>
                        <p>
                            Number of Applicants: {hiring.applications.length}
                        </p>
                        <p>
                            Due:{" "}
                            {hiring.start_date
                                ? hiring.start_date
                                : "Not determined"}
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default YourHirings;
