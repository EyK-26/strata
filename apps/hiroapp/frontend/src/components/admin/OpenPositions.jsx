import axios from "axios";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import OpenPositionPreview from "./OpenPositionPreview";
import SearchBar from "../SeachBar";
import Pagination from "../Pagination";
import SelectDepartment from "./SelectDepartment";

const OpenPositions = () => {
	const [positions, setPositions] = useState([]);
	const [search, setSearch] = useState("");
	const [department, setDepartment] = useState(0);
	const [page, setPage] = useState(1);
	const startResults = 20 * (page - 1);
	const lastPage = Math.floor(positions.length / 20) + 1;

	const loadPositions = async () => {
		try {
			const response = await axios.get(
				`/api/positions?search=${search}&department=${department}`
			);
			setPositions(response.data);
		} catch (error) {
			console.log(error.response.data);
		}
	};

	useEffect(() => {
		loadPositions();
		setPage(1);
	}, [search, department]);

	return (
		<div className="positions">
			<Link to="/positions">
				<h2>Open Positions</h2>
			</Link>
			<div>
				<SearchBar subject="a position" setSearch={setSearch} />
				<SelectDepartment
					department={department}
					setDepartment={setDepartment}
				/>
			</div>
			{positions.length > 20 ? (
				<div>
					<Pagination page={page} setPage={setPage} lastPage={lastPage} />{" "}
				</div>
			) : (
				<div className="pagination-hidden">
					<Pagination page={page} setPage={setPage} lastPage={lastPage} />{" "}
				</div>
			)}
			<div className="list">
				{positions.slice(startResults, startResults + 20).map((position) => (
					<OpenPositionPreview key={position.id} position={position} />
				))}
			</div>
		</div>
	);
};

export default OpenPositions;
