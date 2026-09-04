import axios from "axios";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SearchBar from "../SeachBar";
import Pagination from "../Pagination";

const Applications = () => {
    const [applications, setApplications] = useState([]);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const startResults = 20 * (page - 1);
    const lastPage = Math.floor(applications.length / 20) + 1;

    const loadApplications = async () => {
        const response = await axios.get(`/api/applications?search=${search}`);
        setApplications(response.data);
    };

    useEffect(() => {
        loadApplications();
        setPage(1);
    }, [search]);

    return (
        <div className="applications">
            <Link to="/applications">
                <h2>Applications</h2>
            </Link>
            <SearchBar subject="an application" setSearch={setSearch} />
            {applications.length > 20 && (
                <Pagination page={page} setPage={setPage} lastPage={lastPage} />
            )}
            <div className="list">
                {applications.length !== 0 ? (
                    applications
                        .slice(startResults, startResults + 20)
                        .map((application) => (
                            <Link
                                to={"/applications/" + application.id}
                                key={application.id}
                            >
                                <div
                                    className={
                                        application.status_id === 6
                                            ? "list-item status-ended"
                                            : application.status_id === 5
                                            ? "list-item status-hired"
                                            : "list-item"
                                    }
                                >
                                    <span>{application.position.name}</span>
                                    <span>{application.status.name}</span>
                                </div>
                            </Link>
                        ))
                ) : (
                    <span>No applications</span>
                )}
            </div>
            {applications.length > 20 && (
                <Pagination page={page} setPage={setPage} lastPage={lastPage} />
            )}
        </div>
    );
};

export default Applications;
